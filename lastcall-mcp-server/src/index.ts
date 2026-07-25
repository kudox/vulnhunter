#!/usr/bin/env node
/**
 * LastCall MCP server — a perishable-inventory promotion marketplace.
 *
 * Merchants post expiring inventory (tonight's empty seats, unsold tickets,
 * open slots) as targeted promotions; AI agents search, claim, and redeem
 * them on behalf of users. Merchants pay only on redemption.
 *
 * Transports:
 *   - stdio (default): for local clients (Claude Desktop, Claude Code)
 *   - streamable HTTP: set TRANSPORT=http (and optionally PORT)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { createServer } from "./server.js";
import { EventbriteClient } from "./services/eventbrite.js";
import {
  buildEventbriteInventory,
  promotionRuleFromEnv,
} from "./services/eventbriteInventory.js";
import {
  TicketmasterAdapter,
  ticketmasterConfigFromEnv,
} from "./services/adapters/ticketmaster.js";
import type { SourceAdapter } from "./services/adapters/types.js";
import { runListingIngest } from "./services/ingest.js";
import { InMemoryOfferStore } from "./store/store.js";
import type { OfferStore } from "./store/store.js";

// NOTE: all logging goes to stderr — on the stdio transport, stdout is
// protocol traffic.

function makeStore(): OfferStore {
  const seed = process.env.LASTCALL_SEED !== "off";
  return new InMemoryOfferStore(new Date(), { seed });
}

/**
 * If EVENTBRITE_API_TOKEN is set, pull the token's organizations' live events
 * into the store now, and keep re-syncing on an interval (default 30 min,
 * configurable via EVENTBRITE_REFRESH_MINUTES; 0 disables the interval).
 */
async function startEventbriteSync(store: OfferStore): Promise<void> {
  const token = process.env.EVENTBRITE_API_TOKEN;
  if (!token) {
    console.error("Eventbrite sync disabled (EVENTBRITE_API_TOKEN not set) — serving seed inventory only");
    return;
  }

  const client = new EventbriteClient(token);
  const rule = promotionRuleFromEnv();
  const orgIds = process.env.EVENTBRITE_ORG_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const sync = async (): Promise<void> => {
    const result = await buildEventbriteInventory(client, rule, new Date(), orgIds);
    store.upsertInventory(result.merchants, result.offers);
    console.error(
      `Eventbrite sync: ${result.offers.length} offer(s) from ${result.merchants.length} venue(s); skipped ${result.skipped.length} event(s)` +
        (result.skipped.length > 0
          ? ` (${result.skipped.map((s) => `${s.eventId}: ${s.reason}`).join("; ")})`
          : ""),
    );
  };

  // First sync is awaited so startup fails loudly on a bad token instead of
  // silently serving seed data.
  await sync();

  const refreshMinutes = Number(process.env.EVENTBRITE_REFRESH_MINUTES ?? "30");
  if (Number.isFinite(refreshMinutes) && refreshMinutes > 0) {
    const timer = setInterval(() => {
      sync().catch((error) => {
        console.error("Eventbrite re-sync failed (keeping existing inventory):", error);
      });
    }, refreshMinutes * 60_000);
    timer.unref(); // don't keep the process alive just to re-sync
  }
}

/**
 * OSINT listing ingestion: run every configured source adapter now, then
 * re-sync on an interval (default 60 min, LASTCALL_INGEST_REFRESH_MINUTES;
 * 0 disables). Currently wired: Ticketmaster (TICKETMASTER_API_KEY).
 */
async function startListingIngest(store: OfferStore): Promise<void> {
  const adapters: SourceAdapter[] = [];
  const tmConfig = ticketmasterConfigFromEnv();
  if (tmConfig) adapters.push(new TicketmasterAdapter(tmConfig));

  if (adapters.length === 0) {
    console.error("Listing ingest disabled (no source keys set, e.g. TICKETMASTER_API_KEY)");
    return;
  }

  const sync = async (): Promise<void> => {
    const summary = await runListingIngest(store, adapters);
    const perSource = summary.bySource
      .map((s) => `${s.source}: ${s.error ? `ERROR ${s.error}` : `${s.ingested} in, ${s.skipped} skipped`}`)
      .join(" | ");
    console.error(
      `Listing ingest: ${summary.totalUpserted} upserted, ${summary.merged} merged as duplicates — ${perSource}`,
    );
  };

  await sync();

  const refreshMinutes = Number(process.env.LASTCALL_INGEST_REFRESH_MINUTES ?? "60");
  if (Number.isFinite(refreshMinutes) && refreshMinutes > 0) {
    const timer = setInterval(() => {
      sync().catch((error) => {
        console.error("Listing re-ingest failed (keeping existing listings):", error);
      });
    }, refreshMinutes * 60_000);
    timer.unref();
  }
}

async function runStdio(): Promise<void> {
  const store = makeStore();
  const { server } = createServer({ store });
  await startEventbriteSync(store);
  await startListingIngest(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LastCall MCP server running via stdio");
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  // One store shared across requests; a new transport per request keeps the
  // HTTP layer stateless (no sessions), which is the simplest thing to scale.
  const store = makeStore();
  const { server } = createServer({ store });
  await startEventbriteSync(store);
  await startListingIngest(store);

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  // Bind to loopback by default; deployments behind a real ingress set HOST.
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    console.error(`LastCall MCP server running on http://${host}:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT ?? "stdio";
const main = transport === "http" ? runHttp : runStdio;
main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

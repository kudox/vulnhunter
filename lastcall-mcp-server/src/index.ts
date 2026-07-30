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
import { Analytics, NOOP_ANALYTICS } from "./services/analytics.js";
import { LastcallDb } from "./services/db.js";
import {
  buildListingAdaptersFromEnv,
  syncEventbriteOnce,
  syncListingsOnce,
} from "./services/sources.js";
import { InMemoryOfferStore } from "./store/store.js";
import type { OfferStore } from "./store/store.js";

// NOTE: all logging goes to stderr — on the stdio transport, stdout is
// protocol traffic.

function makeStore(): InMemoryOfferStore {
  const seed = process.env.LASTCALL_SEED !== "off";
  return new InMemoryOfferStore(new Date(), { seed });
}

/**
 * Postgres (DATABASE_URL) enables the durable half of the hybrid store:
 * claims/merchants survive restarts, and the append-only analytics tables
 * (event_snapshots, search_log) start accumulating — history can't be
 * backfilled, so the recorder runs from day one even with zero analytics
 * built on top. Without DATABASE_URL everything no-ops.
 */
async function initPersistence(
  store: InMemoryOfferStore,
): Promise<{ analytics: Analytics; db?: LastcallDb }> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Persistence disabled (DATABASE_URL not set) — claims are in-memory only");
    return { analytics: NOOP_ANALYTICS };
  }
  const db = new LastcallDb(url);
  await db.ensureSchema();

  const open = await db.loadOpenClaims(new Date());
  for (const { claim } of open) store.restoreClaim(claim);

  // Seed offers' baselines land in the shared inventory ledger before any
  // claims arrive; feed syncs refresh their own offers' baselines later.
  const analytics = new Analytics(db);
  const primed = await analytics.primeFingerprints();
  if (primed > 0) console.error(`snapshot recorder primed with ${primed} event fingerprint(s)`);
  analytics.syncInventoryBaselines(
    store.allOffers().filter((o) => o.kind === "offer" && o.source === "seed"),
  );

  // Cross-instance hold expiry: sweeps also run before every reserve; this
  // interval keeps the shared pool fresh even on idle instances.
  const timer = setInterval(() => {
    db.sweepExpiredHolds().catch((error) => {
      console.error("expired-hold sweep failed:", error);
    });
  }, 60_000);
  timer.unref();

  console.error(
    `Postgres persistence on: schema ensured, ${open.length} open claim(s) rehydrated, claim authority = database`,
  );
  return { analytics, db };
}

/**
 * If EVENTBRITE_API_TOKEN is set, pull the token's organizations' live events
 * into the store now, and keep re-syncing on an interval (default 30 min,
 * configurable via EVENTBRITE_REFRESH_MINUTES; 0 disables the interval).
 */
async function startEventbriteSync(store: OfferStore, analytics: Analytics): Promise<void> {
  if (!process.env.EVENTBRITE_API_TOKEN) {
    console.error("Eventbrite sync disabled (EVENTBRITE_API_TOKEN not set) — serving seed inventory only");
    return;
  }

  // First sync is awaited so startup fails loudly on a bad token instead of
  // silently serving seed data.
  console.error(await syncEventbriteOnce(store, analytics));

  const refreshMinutes = Number(process.env.EVENTBRITE_REFRESH_MINUTES ?? "30");
  if (Number.isFinite(refreshMinutes) && refreshMinutes > 0) {
    const timer = setInterval(() => {
      syncEventbriteOnce(store, analytics)
        .then((line) => console.error(line))
        .catch((error) => {
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
async function startListingIngest(store: OfferStore, analytics: Analytics): Promise<void> {
  const adapters = buildListingAdaptersFromEnv();
  if (adapters.length === 0) {
    console.error(
      "Listing ingest disabled (no sources configured — set TICKETMASTER_API_KEY, LASTCALL_JSONLD=on, LASTCALL_ICS=on, and/or LASTCALL_FUNCHEAP=on)",
    );
    return;
  }

  const sync = async (): Promise<void> => {
    console.error(await syncListingsOnce(store, analytics, adapters));
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
  const { analytics, db } = await initPersistence(store);
  const { server } = createServer({ store, analytics, db });
  await startEventbriteSync(store, analytics);
  await startListingIngest(store, analytics);
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
  const { analytics, db } = await initPersistence(store);
  const { server } = createServer({ store, analytics, db });
  await startEventbriteSync(store, analytics);
  await startListingIngest(store, analytics);

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

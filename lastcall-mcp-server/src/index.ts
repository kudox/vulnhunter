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
import { FuncheapAdapter, funcheapConfigFromEnv } from "./services/adapters/funcheap.js";
import { Analytics, NOOP_ANALYTICS } from "./services/analytics.js";
import { LastcallDb } from "./services/db.js";
import { IcsFeedAdapter } from "./services/adapters/icsFeeds.js";
import { JsonLdCrawlerAdapter } from "./services/adapters/jsonldCrawler.js";
import { CURATED_ICS_FEEDS } from "./services/adapters/icsFeedList.js";
import { CURATED_VENUE_PAGES } from "./services/adapters/venues.js";
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
    const syncAt = new Date();
    const result = await buildEventbriteInventory(client, rule, syncAt, orgIds);
    store.upsertInventory(result.merchants, result.offers);
    analytics.persistMerchants(result.merchants);
    // Pre-deduction feed availability -> shared inventory baselines.
    analytics.syncInventoryBaselines(result.offers);
    analytics.recordEventSnapshots(
      store.allOffers().filter((o) => o.source === "eventbrite"),
      syncAt,
    );
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
async function startListingIngest(store: OfferStore, analytics: Analytics): Promise<void> {
  const adapters: SourceAdapter[] = [];
  const tmConfig = ticketmasterConfigFromEnv();
  if (tmConfig) adapters.push(new TicketmasterAdapter(tmConfig));

  // Venue-website crawler: no API key, but it makes outbound requests to
  // third-party sites, so it's opt-in. LASTCALL_JSONLD_VENUES overrides the
  // curated SF list with comma-separated URLs.
  if (process.env.LASTCALL_JSONLD === "on") {
    const urls = process.env.LASTCALL_JSONLD_VENUES?.split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    const venues = urls
      ? urls.map((url) => ({ url, name: new URL(url).hostname }))
      : CURATED_VENUE_PAGES;
    const maxDaysOut = Number(process.env.LASTCALL_LISTING_MAX_DAYS_OUT ?? "14") || 14;
    adapters.push(new JsonLdCrawlerAdapter({ venues, maxDaysOut }));
  }

  // ICS/iCal feeds: free civic + community events. Opt-in like the crawler.
  // LASTCALL_ICS_FEEDS overrides the curated list with comma-separated URLs
  // (webcal:// accepted); overridden feeds default to unknown price.
  if (process.env.LASTCALL_ICS === "on") {
    const urls = process.env.LASTCALL_ICS_FEEDS?.split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    const feeds = urls
      ? urls.map((url) => ({ url, name: new URL(url.replace(/^webcal:\/\//i, "https://")).hostname }))
      : CURATED_ICS_FEEDS;
    const maxDaysOut = Number(process.env.LASTCALL_LISTING_MAX_DAYS_OUT ?? "14") || 14;
    adapters.push(new IcsFeedAdapter({ feeds, maxDaysOut }));
  }

  // Funcheap SF: curated free/cheap events via the JSON-LD on their
  // date-archive pages. Opt-in (third-party fetches): LASTCALL_FUNCHEAP=on.
  const fcConfig = funcheapConfigFromEnv();
  if (fcConfig) adapters.push(new FuncheapAdapter(fcConfig));

  if (adapters.length === 0) {
    console.error(
      "Listing ingest disabled (no sources configured — set TICKETMASTER_API_KEY, LASTCALL_JSONLD=on, LASTCALL_ICS=on, and/or LASTCALL_FUNCHEAP=on)",
    );
    return;
  }

  const sync = async (): Promise<void> => {
    const syncAt = new Date();
    const summary = await runListingIngest(store, adapters, syncAt);
    const listings = store.allOffers().filter((o) => o.kind === "listing");
    analytics.recordEventSnapshots(listings, syncAt);
    analytics.persistMerchants(
      [...new Set(listings.map((o) => o.merchantId))]
        .map((id) => store.getMerchant(id))
        .filter((m): m is NonNullable<typeof m> => m !== undefined),
    );
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

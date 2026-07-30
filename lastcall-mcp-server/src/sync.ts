#!/usr/bin/env node
/**
 * One-shot sync worker: run every configured source once, record snapshots
 * and baselines to Postgres, print a summary, exit. Built for schedulers —
 * cron, GitHub Actions, anything that can run `node dist/sync.js` — so
 * snapshot history accumulates WITHOUT a long-running server.
 *
 *   DATABASE_URL=... TICKETMASTER_API_KEY=... node dist/sync.js
 *
 * Differences from the server:
 *  - Seed (fictional demo) data defaults OFF — it must not pollute the
 *    event_snapshots history. LASTCALL_SEED=on re-enables it.
 *  - No claim hydration, no intervals, no transports.
 *  - Exits 0 with loud warnings when unconfigured (a scheduled run before
 *    secrets are set should nag, not alarm); exits 1 only when configured
 *    work actually failed.
 */

import { Analytics, NOOP_ANALYTICS } from "./services/analytics.js";
import { LastcallDb } from "./services/db.js";
import {
  buildListingAdaptersFromEnv,
  syncEventbriteOnce,
  syncListingsOnce,
} from "./services/sources.js";
import { InMemoryOfferStore } from "./store/store.js";

async function main(): Promise<void> {
  const startedAt = Date.now();
  const seed = process.env.LASTCALL_SEED === "on";
  const store = new InMemoryOfferStore(new Date(), { seed });

  let db: LastcallDb | undefined;
  let analytics = NOOP_ANALYTICS;
  if (process.env.DATABASE_URL) {
    db = new LastcallDb(process.env.DATABASE_URL);
    await db.ensureSchema();
    analytics = new Analytics(db);
    // Fresh process: prime delta-only recording from prior runs' history so
    // unchanged events don't re-record every scheduled run.
    const primed = await analytics.primeFingerprints();
    console.log(`db: connected, schema ensured, ${primed} event fingerprint(s) primed`);
  } else {
    console.log(
      "WARNING: DATABASE_URL not set — this is a dry run; nothing will be recorded",
    );
  }

  let failures = 0;
  let didWork = false;

  if (process.env.EVENTBRITE_API_TOKEN) {
    didWork = true;
    try {
      console.log(await syncEventbriteOnce(store, analytics));
    } catch (error) {
      failures++;
      console.error("eventbrite: sync failed:", error);
    }
  } else {
    console.log("eventbrite: skipped (EVENTBRITE_API_TOKEN not set)");
  }

  const adapters = buildListingAdaptersFromEnv();
  if (adapters.length > 0) {
    didWork = true;
    try {
      // Per-adapter failures are isolated inside the ingest; a thrown error
      // here means the pipeline itself broke.
      const line = await syncListingsOnce(store, analytics, adapters);
      console.log(line);
      if (/ERROR/.test(line)) failures++;
    } catch (error) {
      failures++;
      console.error("listing ingest failed:", error);
    }
  } else {
    console.log(
      "listings: skipped (no sources configured — set TICKETMASTER_API_KEY, LASTCALL_JSONLD=on, LASTCALL_ICS=on, LASTCALL_FUNCHEAP=on)",
    );
  }

  // Fire-and-forget analytics writes need to land before the process exits.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (db) await db.close();

  const listings = store.allOffers().filter((o) => o.kind === "listing").length;
  console.log(
    `sync complete in ${Math.round((Date.now() - startedAt) / 1000)}s — ${listings} listing(s) in view, recording ${db ? "ON" : "OFF"}${failures ? `, ${failures} failure(s)` : ""}`,
  );

  if (!didWork) {
    console.log("NOTE: no sources were configured; nothing was synced");
    return;
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("sync worker crashed:", error);
  process.exit(1);
});

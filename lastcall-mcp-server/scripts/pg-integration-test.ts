/**
 * Postgres integration test — requires a reachable database:
 *
 *   DATABASE_URL=postgres://... npm run test:pg
 *
 * Exercises the real schema and queries: idempotent schema creation, claim
 * persistence through status transitions, boot rehydration (only open claims
 * return, inventory re-deducted), snapshot appends, and search logging.
 * Skips (exit 0 with a notice) when DATABASE_URL is unset so `npm test`
 * stays database-free.
 */

import { Analytics } from "../src/services/analytics.js";
import { LastcallDb } from "../src/services/db.js";
import { InMemoryOfferStore } from "../src/store/store.js";

const NOW = new Date();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PG TEST FAIL: ${message}`);
}

/** Analytics writes are fire-and-forget; give them a beat to land. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300));

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("PG TEST SKIPPED — set DATABASE_URL to run the integration test");
    return;
  }

  const db = new LastcallDb(url);
  await db.ensureSchema();
  await db.ensureSchema(); // idempotent
  console.log("schema: created + idempotent re-run");

  const analytics = new Analytics(db);
  const store = new InMemoryOfferStore(NOW);

  // --- Claim lifecycle persists through transitions ---
  const claimResult = store.claimOffer("off_fogline_tonight", 2, NOW);
  assert(claimResult.ok, "claim should succeed");
  const claim = claimResult.value;
  analytics.persistClaim(claim, store.getOffer(claim.offerId));

  const confirmResult = store.confirmClaim(claim.id, NOW);
  assert(confirmResult.ok, "confirm should succeed");
  analytics.persistClaim(confirmResult.value, store.getOffer(claim.offerId));

  const expiredHold = store.claimOffer("off_velvet_late_set", 2, NOW);
  assert(expiredHold.ok, "second claim should succeed");
  // Persist as a hold that has already lapsed -> must NOT rehydrate.
  analytics.persistClaim(
    { ...expiredHold.value, holdExpiresAt: new Date(NOW.getTime() - 60_000) },
    store.getOffer(expiredHold.value.offerId),
  );
  await settle();

  // --- Rehydration: fresh store + fresh process simulation ---
  const store2 = new InMemoryOfferStore(NOW);
  const before = store2.getOffer(claim.offerId)!.remainingQuantity;
  const open = await db.loadOpenClaims(new Date());
  const openIds = open.map((o) => o.claim.id);
  assert(openIds.includes(claim.id), "confirmed future claim must rehydrate");
  assert(!openIds.includes(expiredHold.value.id), "lapsed hold must NOT rehydrate");
  for (const { claim: c } of open) store2.restoreClaim(c);
  const after = store2.getOffer(claim.offerId)!.remainingQuantity;
  assert(
    after === before - claim.partySize,
    `rehydrated claim must re-deduct inventory (${before} -> ${after})`,
  );
  const confirmAgain = store2.confirmClaim(claim.redemptionCode, NOW);
  assert(confirmAgain.ok, "rehydrated claim must confirm idempotently by code");
  console.log(`claims: persisted, transitioned, rehydrated (${open.length} open), inventory re-deducted`);

  // --- Snapshots: delta-only appends across "syncs" ---
  const offers = store.allOffers().filter((o) => o.kind === "offer").slice(0, 5);
  analytics.recordEventSnapshots(offers, NOW);
  await settle();
  analytics.recordEventSnapshots(offers, new Date(NOW.getTime() + 60_000)); // unchanged -> no rows
  const mutated = { ...offers[0], remainingQuantity: offers[0].remainingQuantity - 3 };
  analytics.recordEventSnapshots([mutated], new Date(NOW.getTime() + 120_000));
  await settle();

  // --- Search log ---
  analytics.logSearch({
    searchedAt: NOW,
    query: "jazz",
    partySize: 2,
    maxPrice: 30,
    withinHours: 6,
    claimableOnly: false,
    resultTotal: 4,
    topResultIds: offers.slice(0, 3).map((o) => o.id),
  });
  await settle();

  // --- Verify raw table contents via a scratch query ---
  const probe = new LastcallDb(url);
  const counts = await (probe as unknown as { pool: import("pg").Pool }).pool.query(
    `SELECT
       (SELECT count(*) FROM claims) AS claims,
       (SELECT count(*) FROM event_snapshots WHERE event_id = $1) AS first_event_snaps,
       (SELECT count(*) FROM event_snapshots) AS snaps,
       (SELECT count(*) FROM search_log) AS searches`,
    [offers[0].id],
  );
  const row = counts.rows[0];
  assert(Number(row.claims) >= 2, `expected >=2 claims rows, got ${row.claims}`);
  assert(
    Number(row.first_event_snaps) === 2,
    `delta-only: first event should have exactly 2 snapshots (initial + mutation), got ${row.first_event_snaps}`,
  );
  assert(Number(row.snaps) === offers.length + 1, `expected ${offers.length + 1} snapshot rows total, got ${row.snaps}`);
  assert(Number(row.searches) >= 1, "search log must have rows");
  console.log(
    `tables: claims=${row.claims}, snapshots=${row.snaps} (delta-only verified), searches=${row.searches}`,
  );

  await probe.close();
  await db.close();
  console.log("\nPG INTEGRATION TEST OK — schema, claims, rehydration, delta snapshots, search log");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

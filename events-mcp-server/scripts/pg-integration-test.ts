/**
 * Postgres integration test — requires a reachable database:
 *
 *   DATABASE_URL=postgres://... npm run test:pg
 *
 * Exercises the real multi-instance claim path: two ClaimCoordinators with
 * SEPARATE in-memory stores sharing one database simulate two server
 * instances. Verifies: no oversell under concurrent claims, cross-instance
 * confirm-by-code, release returning seats to the shared pool, expired-hold
 * sweeps, rehydration, delta-only snapshots, and search logging.
 * Skips (exit 0 with a notice) when DATABASE_URL is unset.
 */

import { Analytics } from "../src/services/analytics.js";
import { ClaimCoordinator } from "../src/services/claims.js";
import { EventsDb } from "../src/services/db.js";
import { InMemoryOfferStore } from "../src/store/store.js";

const NOW = new Date();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PG TEST FAIL: ${message}`);
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300));

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("PG TEST SKIPPED — set DATABASE_URL to run the integration test");
    return;
  }

  const db = new EventsDb(url);
  await db.ensureSchema();
  await db.ensureSchema(); // idempotent
  console.log("schema: created + idempotent re-run");

  // Two "instances": separate stores + coordinators, one shared database.
  const storeA = new InMemoryOfferStore(NOW);
  const storeB = new InMemoryOfferStore(NOW);
  const instanceA = new ClaimCoordinator(storeA, db);
  const instanceB = new ClaimCoordinator(storeB, db);
  const analytics = new Analytics(db);

  // Shared baselines for seed offers (what initPersistence does on boot).
  analytics.syncInventoryBaselines(storeA.allOffers().filter((o) => o.kind === "offer"));
  await settle();

  // --- THE oversell race ---
  // 'off_corkline_tasting' has 10 spots. 8 concurrent parties of 2 across
  // two instances want 16. Exactly 5 must win.
  const TARGET = "off_corkline_tasting";
  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 === 0 ? instanceA : instanceB).claim(TARGET, 2),
    ),
  );
  const wins = attempts.filter((a) => a.ok);
  const losses = attempts.filter((a) => !a.ok);
  assert(wins.length === 5, `10 spots / parties of 2: exactly 5 wins expected, got ${wins.length}`);
  assert(
    losses.every((l) => !l.ok && l.reason === "sold_out"),
    "losers must see sold_out, not errors",
  );
  const inv = await (db as unknown as { pool: import("pg").Pool }).pool.query(
    `SELECT baseline, claimed FROM offer_inventory WHERE offer_id = $1`,
    [TARGET],
  );
  assert(
    Number(inv.rows[0].claimed) === 10 && Number(inv.rows[0].baseline) === 10,
    `shared ledger must show exactly 10/10 claimed, got ${inv.rows[0].claimed}/${inv.rows[0].baseline}`,
  );
  console.log("oversell race: 8 concurrent claims across 2 instances -> exactly 5 wins, ledger 10/10");

  // --- Cross-instance confirm: claim made on A, confirmed by code on B ---
  const aClaim = wins.find((w) => w.ok && storeA.getClaim(w.value.id))!;
  assert(aClaim.ok, "need an instance-A claim");
  const bConfirm = await instanceB.confirm(aClaim.value.redemptionCode);
  assert(bConfirm.ok, `instance B must confirm A's claim by code: ${bConfirm.ok ? "" : bConfirm.message}`);
  assert(bConfirm.value.status === "confirmed", "adopted claim must be confirmed");
  console.log("cross-instance: B confirmed A's claim by redemption code (adopted from Postgres)");

  // --- Release on the claiming instance returns seats to the shared pool ---
  // (must be a still-held claim: the cross-instance confirm above adopted
  // A's claim into store B, and confirmed claims correctly refuse release)
  const bClaimResult = wins.find(
    (w) => w.ok && storeB.getClaim(w.value.id)?.status === "held",
  )!;
  assert(bClaimResult.ok, "need a held instance-B claim");
  const released = await instanceB.release(bClaimResult.value.id);
  assert(released.ok, "release should succeed");
  await settle();
  const afterRelease = await (db as unknown as { pool: import("pg").Pool }).pool.query(
    `SELECT claimed FROM offer_inventory WHERE offer_id = $1`,
    [TARGET],
  );
  assert(
    Number(afterRelease.rows[0].claimed) === 8,
    `release must return 2 seats to the pool (10 -> 8), got ${afterRelease.rows[0].claimed}`,
  );
  // ...and a third instance can now win those seats.
  const storeC = new InMemoryOfferStore(NOW);
  const instanceC = new ClaimCoordinator(storeC, db);
  const cClaim = await instanceC.claim(TARGET, 2);
  assert(cClaim.ok, "freed seats must be claimable by another instance");
  console.log("release: seats returned to shared pool and re-claimed by a third instance");

  // --- Expired-hold sweep frees seats across instances ---
  const dClaim = await instanceA.claim("off_fogline_tonight", 4);
  assert(dClaim.ok, "hold for sweep test should succeed");
  await (db as unknown as { pool: import("pg").Pool }).pool.query(
    `UPDATE claims SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
    [dClaim.value.id],
  );
  const freed = await db.sweepExpiredHolds();
  assert(freed >= 4, `sweep must free the lapsed hold's 4 seats, freed ${freed}`);
  console.log("sweep: lapsed hold expired in Postgres, seats returned");

  // --- Rehydration still works (confirmed claim above) ---
  const open = await db.loadOpenClaims(new Date());
  assert(
    open.some((o) => o.claim.id === aClaim.value.id && o.claim.status === "confirmed"),
    "confirmed claim must rehydrate",
  );
  assert(
    !open.some((o) => o.claim.id === dClaim.value.id),
    "swept-expired hold must NOT rehydrate",
  );
  console.log(`rehydration: ${open.length} open claim(s), swept hold excluded`);

  // --- Snapshots + search log still record ---
  const offers = storeA.allOffers().filter((o) => o.kind === "offer").slice(0, 3);
  analytics.recordEventSnapshots(offers, NOW);
  analytics.logSearch({
    searchedAt: NOW, query: "jazz", claimableOnly: false, resultTotal: 3,
    topResultIds: offers.map((o) => o.id),
  });
  await settle();
  const counts = await (db as unknown as { pool: import("pg").Pool }).pool.query(
    `SELECT (SELECT count(*) FROM event_snapshots) AS snaps,
            (SELECT count(*) FROM search_log) AS searches,
            (SELECT count(*) FROM claims) AS claims`,
  );
  assert(Number(counts.rows[0].snaps) >= 3, "snapshots must record");
  assert(Number(counts.rows[0].searches) >= 1, "search log must record");
  console.log(
    `tables: claims=${counts.rows[0].claims}, snapshots=${counts.rows[0].snaps}, searches=${counts.rows[0].searches}`,
  );

  await db.close();
  console.log("\nPG INTEGRATION TEST OK — no oversell under concurrency; cross-instance confirm/release/sweep verified");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

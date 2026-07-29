/**
 * Analytics unit test (no database): delta-only snapshot selection,
 * fingerprint semantics, and the no-op guarantee that tools work without
 * Postgres.
 *
 *   npm run test:analytics
 */

import { Analytics, diffSnapshots, snapshotFingerprint } from "../src/services/analytics.js";
import { InMemoryOfferStore } from "../src/store/store.js";
import type { Offer } from "../src/types.js";

const NOW = new Date();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ANALYTICS TEST FAIL: ${message}`);
}

function offer(overrides: Partial<Offer>): Offer {
  return {
    id: "off_x",
    kind: "listing",
    source: "ticketmaster",
    sources: ["ticketmaster"],
    merchantId: "mer_x",
    title: "Test Event",
    description: "",
    category: "live_music",
    neighborhood: "Mission",
    startsAt: new Date(NOW.getTime() + 6 * 3_600_000),
    endsAt: new Date(NOW.getTime() + 9 * 3_600_000),
    claimDeadline: new Date(NOW.getTime() + 6 * 3_600_000),
    priceCents: 2000,
    faceValueCents: 2000,
    totalQuantity: 10,
    remainingQuantity: 10,
    minPartySize: 1,
    maxPartySize: 8,
    newCustomersOnly: false,
    sponsored: false,
    terms: "",
    ...overrides,
  };
}

async function main(): Promise<void> {
  // --- Delta selection ---
  const fps = new Map<string, string>();
  const a = offer({ id: "a" });
  const b = offer({ id: "b" });

  const first = diffSnapshots([a, b], fps, NOW);
  assert(first.length === 2, "first sight of both events must snapshot both");

  const second = diffSnapshots([a, b], fps, NOW);
  assert(second.length === 0, "unchanged events must not re-snapshot");

  const aSold = offer({ id: "a", remainingQuantity: 7 });
  const third = diffSnapshots([aSold, b], fps, NOW);
  assert(third.length === 1 && third[0].eventId === "a", "only the changed event snapshots");
  assert(third[0].remainingQuantity === 7, "snapshot carries the new remaining count");

  // Fingerprint sensitivity: the things analytics cares about
  assert(
    snapshotFingerprint(offer({})) !== snapshotFingerprint(offer({ priceCents: 1500 })),
    "price change must alter fingerprint",
  );
  assert(
    snapshotFingerprint(offer({})) !==
      snapshotFingerprint(offer({ startsAt: new Date(NOW.getTime() + 7 * 3_600_000) })),
    "reschedule must alter fingerprint",
  );
  assert(
    snapshotFingerprint(offer({})) !==
      snapshotFingerprint(offer({ sources: ["ticketmaster", "funcheap"] })),
    "new corroboration must alter fingerprint",
  );
  assert(
    snapshotFingerprint(offer({})) === snapshotFingerprint(offer({ description: "different" })),
    "cosmetic text changes must NOT trigger snapshots",
  );
  console.log("delta selection: first-sight, unchanged-suppressed, changed-only, fingerprint fields");

  // --- No-op Analytics never throws and store flows are unaffected ---
  const noop = new Analytics();
  assert(!noop.enabled, "analytics without db must report disabled");
  noop.recordEventSnapshots([a, b]);
  noop.persistMerchants([]);
  noop.logSearch({ searchedAt: NOW, claimableOnly: false, resultTotal: 0, topResultIds: [] });

  const store = new InMemoryOfferStore(NOW);
  const claim = store.claimOffer("off_fogline_tonight", 2, NOW);
  assert(claim.ok, "seed claim works");
  noop.persistClaim(claim.value, store.getOffer("off_fogline_tonight"));
  console.log("no-op mode: all methods safe without a database");

  console.log("\nANALYTICS TEST OK — delta-only recording and no-op safety pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

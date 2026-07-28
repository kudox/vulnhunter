/**
 * Listings pipeline test: Ticketmaster adapter (fake fetch, canned Discovery
 * API payloads), the dedup/merge engine, and store integration — including
 * the invariant that a listing never shadows or claims like an offer.
 *
 *   npm run test:listings
 */

import {
  TicketmasterAdapter,
  mapTmEventToListing,
  type TicketmasterConfig,
} from "../src/services/adapters/ticketmaster.js";
import type { AdapterResult, SourceAdapter } from "../src/services/adapters/types.js";
import { dedupeIncoming, normalizeTokens, tokenSimilarity } from "../src/services/dedup.js";
import { runListingIngest } from "../src/services/ingest.js";
import type { FetchLike } from "../src/services/eventbrite.js";
import { InMemoryOfferStore } from "../src/store/store.js";
import type { Merchant, Offer } from "../src/types.js";

// Real clock, not a pinned date — see eventbrite-test.ts for why.
const NOW = new Date();
const hours = (h: number): string => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`LISTINGS TEST FAIL: ${message}`);
}

// --- Canned Ticketmaster Discovery payloads (two pages) ---

const tmEventsPage1 = [
  {
    // Ingestable: priced, tonight, SoMa venue, Music segment.
    id: "tm1",
    name: "Neon Harbor World Tour",
    url: "https://www.ticketmaster.com/event/tm1",
    dates: { start: { dateTime: hours(5) }, status: { code: "onsale" } },
    priceRanges: [{ type: "standard", currency: "USD", min: 59.5, max: 150 }],
    classifications: [{ segment: { name: "Music" } }],
    _embedded: {
      venues: [
        {
          id: "tv1",
          name: "Harborline Pavilion",
          postalCode: "94103",
          city: { name: "San Francisco" },
          address: { line1: "700 Howard St" },
        },
      ],
    },
  },
  {
    // Ingestable but price unknown (no priceRanges).
    id: "tm2",
    name: "Comedy Night: Open Deck",
    url: "https://www.ticketmaster.com/event/tm2",
    dates: { start: { dateTime: hours(26) }, status: { code: "onsale" } },
    classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Comedy" } }],
    _embedded: {
      venues: [{ id: "tv2", name: "Brickhouse Theater", postalCode: "94114", city: { name: "San Francisco" } }],
    },
  },
  {
    // Skipped: date-only TBA (no dateTime).
    id: "tm3",
    name: "TBA Festival Day Pass",
    dates: { start: { localDate: "2026-08-01" } },
  },
];

const tmEventsPage2 = [
  {
    // Skipped: cancelled.
    id: "tm4",
    name: "Cancelled Arena Show",
    dates: { start: { dateTime: hours(50) }, status: { code: "cancelled" } },
  },
  {
    // Duplicate of an existing claimable EB offer (same title/venue/time) —
    // must be dropped by anchor dedup.
    id: "tm5",
    name: "Vinyl Night: Live Trio",
    url: "https://www.ticketmaster.com/event/tm5",
    dates: { start: { dateTime: hours(6) }, status: { code: "onsale" } },
    priceRanges: [{ type: "standard", currency: "USD", min: 35 }],
    classifications: [{ segment: { name: "Music" } }],
    _embedded: {
      venues: [{ id: "tv5", name: "The Pressing Room", postalCode: "94110", city: { name: "San Francisco" } }],
    },
  },
  {
    // Sports segment mapping check.
    id: "tm6",
    name: "Bay City FC vs. Rivertown",
    url: "https://www.ticketmaster.com/event/tm6",
    dates: { start: { dateTime: hours(70) }, status: { code: "onsale" } },
    priceRanges: [{ currency: "USD", min: 28 }],
    classifications: [{ segment: { name: "Sports" } }],
    _embedded: {
      venues: [{ id: "tv6", name: "Bayfront Stadium", postalCode: "94107", city: { name: "San Francisco" } }],
    },
  },
];

const tmFakeFetch: FetchLike = async (rawUrl) => {
  const url = new URL(rawUrl);
  assert(url.pathname === "/discovery/v2/events.json", `unexpected TM path ${url.pathname}`);
  assert(url.searchParams.get("apikey") === "tm-fake-key", "apikey must be sent");
  assert(url.searchParams.get("city") === "San Francisco", "city param must be sent");
  const page = url.searchParams.get("page");
  const body =
    page === "0"
      ? { _embedded: { events: tmEventsPage1 }, page: { totalPages: 2, number: 0 } }
      : { _embedded: { events: tmEventsPage2 }, page: { totalPages: 2, number: 1 } };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const TM_CONFIG: TicketmasterConfig = {
  apiKey: "tm-fake-key",
  city: "San Francisco",
  stateCode: "CA",
  maxDaysOut: 14,
};

/** Existing claimable offer that tm5 duplicates (as if from the Eventbrite sync). */
function existingEbOffer(): { merchant: Merchant; offer: Offer } {
  const merchant: Merchant = {
    id: "mer_eb_venue_v1",
    name: "The Pressing Room",
    category: "live_music",
    neighborhood: "Mission",
    address: "500 Valencia St",
    description: "Test venue",
  };
  const startsAt = new Date(hours(6));
  const offer: Offer = {
    id: "off_eb_5001",
    kind: "offer",
    source: "eventbrite",
    sourceUrl: "https://www.eventbrite.com/e/5001",
    sources: ["eventbrite"],
    merchantId: merchant.id,
    title: "Vinyl Night: Live Trio — 25% off, last-minute seats",
    description: "Test offer",
    category: "live_music",
    neighborhood: "Mission",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
    claimDeadline: new Date(startsAt.getTime() - 2 * 3_600_000),
    priceCents: 3000,
    faceValueCents: 4000,
    totalQuantity: 40,
    remainingQuantity: 40,
    minPartySize: 1,
    maxPartySize: 8,
    newCustomersOnly: false,
    sponsored: false,
    terms: "Test terms",
  };
  return { merchant, offer };
}

async function main(): Promise<void> {
  // --- Unit: token similarity behaves as dedup expects ---
  assert(
    tokenSimilarity(normalizeTokens("Vinyl Night: Live Trio"), normalizeTokens("Vinyl Night — The Live Trio at The Pressing Room")) >= 0.5,
    "near-identical titles should match",
  );
  assert(
    tokenSimilarity(normalizeTokens("Neon Harbor World Tour"), normalizeTokens("Beginner Salsa Social")) < 0.5,
    "unrelated titles must not match",
  );

  // --- Adapter: mapping + pagination ---
  const adapter = new TicketmasterAdapter(TM_CONFIG, tmFakeFetch);
  const result = await adapter.fetch(NOW);
  assert(result.offers.length === 4, `expected 4 mapped listings, got ${result.offers.length}`);
  assert(result.skipped.length === 2, `expected 2 skips, got ${result.skipped.length}`);
  const skipReasons = Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]));
  assert(skipReasons["tm3"] === "no concrete start time", `tm3: ${skipReasons["tm3"]}`);
  assert(skipReasons["tm4"] === "status cancelled", `tm4: ${skipReasons["tm4"]}`);

  const neon = result.offers.find((o) => o.id === "off_tm_tm1");
  assert(neon, "tm1 listing missing");
  assert(neon.kind === "listing" && neon.source === "ticketmaster", "tm1 must be a ticketmaster listing");
  assert(neon.priceCents === 5950 && !neon.priceUnknown, `tm1 price should be 5950, got ${neon.priceCents}`);
  assert(neon.neighborhood === "SoMa", `zip 94103 -> SoMa, got ${neon.neighborhood}`);

  const comedy = result.offers.find((o) => o.id === "off_tm_tm2");
  assert(comedy?.category === "comedy", `genre Comedy -> comedy, got ${comedy?.category}`);
  assert(comedy?.priceUnknown === true, "tm2 has no priceRanges -> priceUnknown");

  const sports = result.offers.find((o) => o.id === "off_tm_tm6");
  assert(sports?.category === "sports", `segment Sports -> sports, got ${sports?.category}`);
  console.log("adapter: 4 listings mapped (price, zip->neighborhood, comedy/sports categories), 2 skipped");

  // --- Ingest into a store holding a duplicate claimable offer ---
  const store = new InMemoryOfferStore(NOW, { seed: false });
  const eb = existingEbOffer();
  store.upsertInventory([eb.merchant], [eb.offer]);

  const summary = await runListingIngest(store, [adapter], NOW);
  assert(summary.totalUpserted === 3, `tm5 should merge into the EB offer: expected 3 upserted, got ${summary.totalUpserted}`);
  assert(summary.merged === 1, `expected 1 merge, got ${summary.merged}`);
  assert(!store.getOffer("off_tm_tm5"), "duplicate TM listing must not be stored");
  assert(store.getOffer("off_eb_5001")?.kind === "offer", "the claimable offer must survive dedup");
  console.log("ingest: duplicate listing merged into existing claimable offer (offer wins)");

  // --- Store behavior: search mixing, filters, claim guard ---
  const all = store.searchOffers({ limit: 20, offset: 0 }, NOW);
  assert(all.total === 4, `expected 4 total results (1 offer + 3 listings), got ${all.total}`);

  const claimables = store.searchOffers({ limit: 20, offset: 0, claimableOnly: true }, NOW);
  assert(claimables.total === 1 && claimables.offers[0].id === "off_eb_5001", "claimableOnly should return just the offer");

  const under40 = store.searchOffers({ limit: 20, offset: 0, maxPrice: 40 }, NOW);
  assert(
    under40.offers.every((o) => !o.priceUnknown && o.priceCents <= 4000),
    "price cap must exclude unknown-priced listings",
  );

  const claimAttempt = store.claimOffer("off_tm_tm1", 2, NOW);
  assert(!claimAttempt.ok, "claiming a listing must fail");
  assert(
    !claimAttempt.ok && claimAttempt.message.includes("ticketmaster.com"),
    "listing claim error should point to the source URL",
  );
  console.log("store: mixed search, claimable_only filter, price cap, and listing claim guard all correct");

  // --- Cross-source merge precedence: aggregator vs ticketing API ---
  const aggregatorDupe: SourceAdapter = {
    name: "funcheap",
    fetch: async (): Promise<AdapterResult> => ({
      merchants: [
        { id: "mer_fc_1", name: "Harborline Pavilion", category: "live_music", neighborhood: "SoMa", address: "", description: "" },
      ],
      offers: [
        {
          ...result.offers.find((o) => o.id === "off_tm_tm1")!,
          id: "off_fc_999",
          source: "funcheap",
          sources: ["funcheap"],
          merchantId: "mer_fc_1",
          title: "Neon Harbor — World Tour",
        },
      ],
      skipped: [],
    }),
  };
  const store2 = new InMemoryOfferStore(NOW, { seed: false });
  const summary2 = await runListingIngest(store2, [adapter, aggregatorDupe], NOW);
  assert(summary2.merged === 1, `cross-source dupe should merge, got ${summary2.merged}`);
  const winner = store2.getOffer("off_tm_tm1");
  assert(winner, "ticketing-API record must win precedence over aggregator");
  assert(
    (winner.sources ?? []).includes("funcheap") && (winner.sources ?? []).includes("ticketmaster"),
    `winner should carry both sources, got ${winner.sources}`,
  );
  assert(!store2.getOffer("off_fc_999"), "aggregator duplicate must not be stored");
  console.log("dedup: ticketmaster beats funcheap on precedence; provenance carries both sources");

  console.log("\nLISTINGS TEST OK — adapter, dedup precedence, ingest, and store guards all pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Eventbrite integration test against a fake fetch serving canned v3 API
 * payloads — no token or network needed.
 *
 *   npm run test:eventbrite
 *
 * Covers: pagination, event -> offer mapping (discount math, zip -> neighborhood,
 * category mapping, spot capping), rule-based skips (sold-out, selling-well,
 * free, too-far-out), ticket-availability fallback, and store upsert semantics
 * (re-sync preserves locally held spots).
 */

import { EventbriteClient, type FetchLike } from "../src/services/eventbrite.js";
import {
  DEFAULT_PROMOTION_RULE,
  buildEventbriteInventory,
} from "../src/services/eventbriteInventory.js";
import { InMemoryOfferStore } from "../src/store/store.js";

const NOW = new Date("2026-07-25T18:00:00Z");
const hours = (h: number): string => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`EVENTBRITE TEST FAIL: ${message}`);
}

// --- Canned API payloads ---

const events = [
  {
    // Promotable: paid, 25% sold, tonight, SF Mission venue, Music category.
    id: "5001",
    name: { text: "Vinyl Night: Live Trio" },
    summary: "An evening of live jazz over rare pressings.",
    url: "https://www.eventbrite.com/e/5001",
    start: { utc: hours(6) },
    end: { utc: hours(9) },
    category_id: "103",
    venue: {
      id: "v1",
      name: "The Pressing Room",
      address: { address_1: "500 Valencia St", city: "San Francisco", postal_code: "94110" },
    },
    ticket_availability: { has_available_tickets: true, is_sold_out: false },
  },
  {
    // Skipped: 90% sold — selling fine without a promotion.
    id: "5002",
    name: { text: "Sold-Well Showcase" },
    start: { utc: hours(8) },
    end: { utc: hours(10) },
    category_id: "105",
    venue: { id: "v2", name: "Castro Stage", address: { postal_code: "94114", city: "San Francisco" } },
    ticket_availability: { has_available_tickets: true, is_sold_out: false },
  },
  {
    // Skipped: sold out.
    id: "5003",
    name: { text: "Sold Out Gala" },
    start: { utc: hours(9) },
    end: { utc: hours(12) },
    venue: { id: "v3" },
    ticket_availability: { is_sold_out: true },
  },
  {
    // Skipped: free event — nothing to discount.
    id: "5004",
    name: { text: "Free Community Meetup" },
    start: { utc: hours(20) },
    end: { utc: hours(22) },
    category_id: "113",
    venue: { id: "v4" },
    ticket_availability: { has_available_tickets: true },
  },
  {
    // Skipped: starts beyond maxDaysOut (14 days).
    id: "5005",
    name: { text: "Distant Future Fest" },
    start: { utc: hours(24 * 20) },
    end: { utc: hours(24 * 20 + 5) },
    venue: { id: "v5" },
    ticket_availability: { has_available_tickets: true },
  },
  {
    // Promotable via ticket_availability fallback: ticket classes 404 for this
    // event, so price comes from minimum_ticket_price.
    id: "5006",
    name: { text: "Gallery After Hours" },
    start: { utc: hours(30) },
    end: { utc: hours(33) },
    category_id: "105",
    venue: {
      id: "v6",
      name: "Pier Gallery",
      address: { address_1: "1 Ferry Plaza", city: "San Francisco", postal_code: "94111" },
    },
    ticket_availability: {
      has_available_tickets: true,
      is_sold_out: false,
      minimum_ticket_price: { value: 2000, currency: "USD" },
    },
  },
];

const ticketClassesByEvent: Record<string, unknown[]> = {
  // 200 total, 50 sold => 150 available (capped to rule.maxSpots=40), $40 face.
  "5001": [
    { id: "t1", free: false, cost: { value: 4000, currency: "USD" }, quantity_total: 120, quantity_sold: 30 },
    { id: "t2", free: false, cost: { value: 6500, currency: "USD" }, quantity_total: 80, quantity_sold: 20 },
    { id: "t3", free: true, quantity_total: 500, quantity_sold: 0 }, // free tier ignored
  ],
  "5002": [
    { id: "t4", free: false, cost: { value: 3000, currency: "USD" }, quantity_total: 100, quantity_sold: 90 },
  ],
  "5003": [
    { id: "t5", free: false, cost: { value: 5000, currency: "USD" }, quantity_total: 50, quantity_sold: 50 },
  ],
  "5004": [{ id: "t6", free: true, quantity_total: 200, quantity_sold: 10 }],
  "5005": [
    { id: "t7", free: false, cost: { value: 8000, currency: "USD" }, quantity_total: 1000, quantity_sold: 10 },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fakeFetch: FetchLike = async (rawUrl) => {
  const url = new URL(rawUrl);
  const path = url.pathname;

  if (path === "/v3/users/me/organizations/") {
    return jsonResponse({
      organizations: [{ id: "org1", name: "Bay Nights Presents" }],
      pagination: { has_more_items: false },
    });
  }

  if (path === "/v3/organizations/org1/events/") {
    assert(url.searchParams.get("status") === "live", "events request must filter status=live");
    assert(
      (url.searchParams.get("expand") ?? "").includes("ticket_availability"),
      "events request must expand ticket_availability",
    );
    // Two pages to exercise continuation pagination.
    if (url.searchParams.get("continuation") === "page2") {
      return jsonResponse({ events: events.slice(3), pagination: { has_more_items: false } });
    }
    return jsonResponse({
      events: events.slice(0, 3),
      pagination: { has_more_items: true, continuation: "page2" },
    });
  }

  const ticketMatch = path.match(/^\/v3\/events\/(\d+)\/ticket_classes\/$/);
  if (ticketMatch) {
    const classes = ticketClassesByEvent[ticketMatch[1]];
    if (!classes) return jsonResponse({ error: "NOT_FOUND" }, 404); // event 5006: fallback path
    return jsonResponse({ ticket_classes: classes, pagination: { has_more_items: false } });
  }

  return jsonResponse({ error: "NOT_FOUND", path }, 404);
};

async function main(): Promise<void> {
  const client = new EventbriteClient("fake-token", fakeFetch);
  const result = await buildEventbriteInventory(client, DEFAULT_PROMOTION_RULE, NOW);

  // --- Mapping outcomes ---
  assert(result.offers.length === 2, `expected 2 promotable offers, got ${result.offers.length}`);
  assert(result.skipped.length === 4, `expected 4 skipped events, got ${result.skipped.length}`);
  const skipReasons = Object.fromEntries(result.skipped.map((s) => [s.eventId, s.reason]));
  assert(skipReasons["5002"]?.includes("selling well"), `5002 skip reason: ${skipReasons["5002"]}`);
  assert(skipReasons["5003"] === "sold out", `5003 skip reason: ${skipReasons["5003"]}`);
  assert(skipReasons["5004"] === "free or unpriced event", `5004 skip reason: ${skipReasons["5004"]}`);
  assert(skipReasons["5005"]?.includes("days out"), `5005 skip reason: ${skipReasons["5005"]}`);
  console.log("mapping: 2 promoted, 4 skipped with correct reasons");

  // --- The fully-detailed offer (event 5001) ---
  const offer = result.offers.find((o) => o.id === "off_eb_5001");
  assert(offer, "offer off_eb_5001 missing");
  assert(offer.faceValueCents === 4000, `face value should be cheapest paid tier (4000), got ${offer.faceValueCents}`);
  assert(offer.priceCents === 3000, `25% off 4000 should be 3000, got ${offer.priceCents}`);
  assert(offer.totalQuantity === 40, `150 available capped to maxSpots=40, got ${offer.totalQuantity}`);
  assert(offer.neighborhood === "Mission", `zip 94110 should map to Mission, got ${offer.neighborhood}`);
  assert(offer.category === "live_music", `category 103 should map to live_music, got ${offer.category}`);
  assert(offer.sponsored === false, "feed offers must not be sponsored by default");
  assert(offer.terms.includes("https://www.eventbrite.com/e/5001"), "terms should link the event page");
  console.log(`offer 5001: $40.00 -> $30.00, 40 spots, Mission/live_music`);

  // --- Fallback offer (event 5006, no ticket classes) ---
  const fallback = result.offers.find((o) => o.id === "off_eb_5006");
  assert(fallback, "fallback offer off_eb_5006 missing");
  assert(fallback.faceValueCents === 2000, `fallback face value from min_ticket_price, got ${fallback.faceValueCents}`);
  assert(fallback.priceCents === 1500, `25% off 2000 should be 1500, got ${fallback.priceCents}`);
  assert(fallback.neighborhood === "Financial District", `zip 94111 -> Financial District, got ${fallback.neighborhood}`);
  console.log("offer 5006: priced via ticket_availability fallback (ticket classes 404)");

  // --- Merchants come from venues ---
  const merchant = result.merchants.find((m) => m.id === "mer_eb_venue_v1");
  assert(merchant, "venue merchant missing");
  assert(merchant.name === "The Pressing Room", `merchant name from venue, got ${merchant.name}`);
  console.log("merchants: derived from venues with org attribution");

  // --- Store upsert: re-sync preserves locally held spots ---
  const store = new InMemoryOfferStore(NOW, { seed: false });
  store.upsertInventory(result.merchants, result.offers);
  assert(store.searchOffers({ limit: 10, offset: 0 }, NOW).total === 2, "store should serve 2 feed offers");

  const claim = store.claimOffer("off_eb_5001", 3, NOW);
  assert(claim.ok, "claim on feed offer should succeed");
  assert(store.getOffer("off_eb_5001")?.remainingQuantity === 37, "claim should consume 3 spots");

  store.upsertInventory(result.merchants, result.offers); // simulated re-sync
  const afterResync = store.getOffer("off_eb_5001")?.remainingQuantity;
  assert(afterResync === 37, `re-sync must preserve held spots (expected 37, got ${afterResync})`);

  const confirmed = store.confirmClaim(claim.value.id, NOW);
  assert(confirmed.ok, "confirm after re-sync should succeed");
  console.log("store: re-sync preserved active hold; confirm still works");

  console.log("\nEVENTBRITE TEST OK — sync, mapping rules, fallback, and re-sync semantics all pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * JSON-LD venue crawler test: fake fetch serving canned venue pages +
 * robots.txt. Covers block extraction, @graph/ItemList walking, event
 * mapping (prices, free events, cancelled, date-only, relative URLs),
 * robots.txt compliance, stable IDs across re-syncs, and cross-adapter
 * dedup precedence vs Ticketmaster.
 *
 *   npm run test:jsonld
 */

import {
  JsonLdCrawlerAdapter,
  extractJsonLdBlocks,
  isPathAllowedByRobots,
  parseEventDate,
  type JsonLdCrawlerConfig,
} from "../src/services/adapters/jsonldCrawler.js";
import type { AdapterResult, SourceAdapter } from "../src/services/adapters/types.js";
import { runListingIngest } from "../src/services/ingest.js";
import type { FetchLike } from "../src/services/eventbrite.js";
import { InMemoryOfferStore } from "../src/store/store.js";

const NOW = new Date("2026-07-25T18:00:00Z");
const hours = (h: number): string => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`JSONLD TEST FAIL: ${message}`);
}

// --- Canned venue pages ---

// Venue 1: modern page — @graph with events, one cancelled, one free, one relative URL.
const venue1Html = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MusicEvent",
      "name": "Cassette Futures — album release",
      "startDate": "${hours(7)}",
      "endDate": "${hours(10)}",
      "url": "/events/cassette-futures",
      "eventStatus": "https://schema.org/EventScheduled",
      "location": {
        "@type": "MusicVenue",
        "name": "The Grand Static",
        "address": { "streetAddress": "1192 Folsom St", "postalCode": "94103", "addressLocality": "San Francisco" }
      },
      "offers": [{ "@type": "Offer", "price": "28.50", "priceCurrency": "USD" }]
    },
    {
      "@type": "EducationEvent",
      "name": "Free Synth Workshop",
      "startDate": "${hours(30)}",
      "url": "https://grandstatic.example/workshops/synth",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "location": { "@type": "Place", "name": "The Grand Static" }
    },
    {
      "@type": "MusicEvent",
      "name": "Cancelled Headliner",
      "startDate": "${hours(50)}",
      "eventStatus": "https://schema.org/EventCancelled"
    },
    {
      "@type": "Festival",
      "name": "All-Day Block Party",
      "startDate": "2026-08-01"
    },
    {
      "@type": "MusicEvent",
      "name": "Naive Time Show",
      "startDate": "2026-07-26T20:00:00",
      "url": "/events/naive-time"
    }
  ]
}
</script>
<script type="application/ld+json">{ this is malformed json-ld and must be ignored }</script>
</head><body>events</body></html>`;

// Venue 2: ItemList of events, price unknown (no offers).
const venue2Html = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "item": {
      "@type": "ComedyEvent",
      "name": "Neon Harbor World Tour",
      "startDate": "${hours(5)}",
      "url": "https://pierhall.example/neon-harbor"
    }},
    { "@type": "ListItem", "position": 2, "item": {
      "@type": "TheaterEvent",
      "name": "Glass Harbor — preview",
      "startDate": "${hours(26)}",
      "url": "https://pierhall.example/glass-harbor"
    }}
  ]
}
</script></head><body></body></html>`;

// Venue 3: robots.txt forbids its events path.
const venue3Robots = `User-agent: *\nDisallow: /private-calendar\n`;

const fakeFetch: FetchLike = async (rawUrl, init) => {
  const url = new URL(rawUrl);
  const ua = (init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? "";
  assert(ua.includes("EventsBot"), "crawler must send its identifiable User-Agent");

  if (url.pathname === "/robots.txt") {
    const body = url.hostname === "walled.example" ? venue3Robots : "User-agent: *\nDisallow:\n";
    return new Response(body, { status: 200 });
  }
  if (url.hostname === "grandstatic.example") return new Response(venue1Html, { status: 200 });
  if (url.hostname === "pierhall.example") return new Response(venue2Html, { status: 200 });
  if (url.hostname === "walled.example") {
    throw new Error("crawler fetched a robots-disallowed page");
  }
  if (url.hostname === "down.example") return new Response("gone", { status: 404 });
  throw new Error(`unexpected fetch: ${rawUrl}`);
};

const CONFIG: JsonLdCrawlerConfig = {
  venues: [
    { url: "https://grandstatic.example/calendar", name: "The Grand Static", neighborhood: "SoMa", category: "live_music" },
    { url: "https://pierhall.example/events", name: "Pier Hall", neighborhood: "Financial District" },
    { url: "https://walled.example/private-calendar", name: "Walled Garden" },
    { url: "https://down.example/events", name: "Down Venue" },
  ],
  maxDaysOut: 14,
};

async function main(): Promise<void> {
  // --- Unit: robots parsing ---
  assert(!isPathAllowedByRobots(venue3Robots, "/private-calendar"), "disallow rule must block");
  assert(isPathAllowedByRobots(venue3Robots, "/public"), "unrelated path must pass");
  assert(isPathAllowedByRobots("User-agent: *\nDisallow:\n", "/anything"), "empty disallow = allow all");

  // --- Unit: block extraction tolerates malformed JSON ---
  assert(extractJsonLdBlocks(venue1Html).length === 1, "malformed JSON-LD block must be skipped, valid one kept");

  // --- Unit: naive datetimes are venue-local, not UTC (the Live Nation quirk) ---
  assert(
    parseEventDate("2026-07-26T20:00:00", "America/Los_Angeles")?.toISOString() ===
      "2026-07-27T03:00:00.000Z",
    "naive 8pm PDT must become 03:00Z next day",
  );
  assert(
    parseEventDate("2026-07-26T20:00:00-07:00", "America/Los_Angeles")?.toISOString() ===
      "2026-07-27T03:00:00.000Z",
    "explicit offset must be respected as-is",
  );

  // --- Adapter run ---
  const adapter = new JsonLdCrawlerAdapter(CONFIG, fakeFetch);
  const result = await adapter.fetch(NOW);

  assert(result.offers.length === 5, `expected 5 listings, got ${result.offers.length}`);

  const naive = result.offers.find((o) => o.title === "Naive Time Show");
  assert(
    naive?.startsAt.toISOString() === "2026-07-27T03:00:00.000Z",
    `naive datetime must map to venue-local time, got ${naive?.startsAt.toISOString()}`,
  );
  const reasons = result.skipped.map((s) => s.reason);
  assert(reasons.includes("disallowed by robots.txt"), "walled venue must be robots-skipped");
  assert(reasons.includes("HTTP 404"), "down venue must be reported");
  assert(reasons.some((r) => r.startsWith("status")), "cancelled event must be skipped");
  assert(reasons.includes("date-only start (no time)"), "date-only event must be skipped");

  const cassette = result.offers.find((o) => o.title.startsWith("Cassette Futures"));
  assert(cassette, "priced MusicEvent missing");
  assert(cassette.priceCents === 2850 && !cassette.priceUnknown, `price should be 2850, got ${cassette.priceCents}`);
  assert(cassette.neighborhood === "SoMa", `zip 94103 -> SoMa, got ${cassette.neighborhood}`);
  assert(cassette.category === "live_music", `MusicEvent -> live_music, got ${cassette.category}`);
  assert(
    cassette.sourceUrl === "https://grandstatic.example/events/cassette-futures",
    `relative URL must resolve, got ${cassette.sourceUrl}`,
  );
  assert(cassette.source === "jsonld:grandstatic.example", `source must be host-prefixed, got ${cassette.source}`);

  const workshop = result.offers.find((o) => o.title === "Free Synth Workshop");
  assert(workshop && workshop.priceCents === 0 && !workshop.priceUnknown, "price 0 must mean Free, not unknown");

  const comedy = result.offers.find((o) => o.title === "Neon Harbor World Tour");
  assert(comedy?.priceUnknown === true, "no offers block -> priceUnknown");
  assert(comedy?.neighborhood === "Financial District", "venue-config neighborhood fallback");
  console.log("adapter: 5 listings (priced, free, unknown-price, naive-tz), robots/404/cancelled/date-only skips correct");

  // --- Stable IDs across runs ---
  const rerun = await adapter.fetch(NOW);
  const ids = (r: AdapterResult) => r.offers.map((o) => o.id).sort().join(",");
  assert(ids(result) === ids(rerun), "listing IDs must be stable across syncs");
  console.log("ids: stable across re-crawls");

  // --- Ingest twice: re-sync must upsert in place, not self-dedupe (prefix anchor fix) ---
  const store = new InMemoryOfferStore(NOW, { seed: false });
  const first = await runListingIngest(store, [adapter], NOW);
  assert(first.totalUpserted === 5, `first ingest should upsert 5, got ${first.totalUpserted}`);
  const second = await runListingIngest(store, [adapter], NOW);
  assert(
    second.totalUpserted === 5 && second.merged === 0,
    `re-sync must not self-dedupe (got upserted=${second.totalUpserted}, merged=${second.merged})`,
  );
  console.log("ingest: prefixed-source re-sync upserts in place (anchor prefix fix verified)");

  // --- Cross-adapter precedence: Ticketmaster (90) beats jsonld (70) for the same show ---
  const tmDupe: SourceAdapter = {
    name: "ticketmaster",
    fetch: async (): Promise<AdapterResult> => ({
      merchants: [
        { id: "mer_tm_venue_x", name: "Pier Hall", category: "comedy", neighborhood: "Financial District", address: "", description: "" },
      ],
      offers: [
        {
          ...comedy!,
          id: "off_tm_dupe1",
          source: "ticketmaster",
          sources: ["ticketmaster"],
          merchantId: "mer_tm_venue_x",
          priceCents: 4200,
          priceUnknown: false,
        },
      ],
      skipped: [],
    }),
  };
  const store2 = new InMemoryOfferStore(NOW, { seed: false });
  const combined = await runListingIngest(store2, [adapter, tmDupe], NOW);
  assert(combined.merged === 1, `TM/jsonld dupe should merge once, got ${combined.merged}`);
  const winner = store2.getOffer("off_tm_dupe1");
  assert(winner, "ticketmaster record must win precedence over jsonld");
  assert(
    (winner.sources ?? []).some((s) => s.startsWith("jsonld:")),
    `winner must carry jsonld corroboration, got ${winner.sources}`,
  );
  console.log("dedup: ticketmaster beats jsonld; corroboration preserved");

  console.log("\nJSONLD TEST OK — extraction, mapping, robots compliance, stable IDs, and precedence all pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

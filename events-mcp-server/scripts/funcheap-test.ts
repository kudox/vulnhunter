/**
 * Funcheap adapter test: canned date-archive pages (matching Funcheap's real
 * JSON-LD shape) through a fake fetch. Covers free/priced/unknown pricing,
 * SF region filtering, neighborhood-from-title-parens, zip extraction,
 * category inference, cancelled skips, robots compliance, empty days,
 * multi-day pagination, and stable IDs.
 *
 *   npm run test:funcheap
 */

import {
  FuncheapAdapter,
  inferCategory,
  neighborhoodFromTitle,
  type FuncheapConfig,
} from "../src/services/adapters/funcheap.js";
import type { FetchLike } from "../src/services/eventbrite.js";
import { runListingIngest } from "../src/services/ingest.js";
import { InMemoryOfferStore } from "../src/store/store.js";

// Real clock; fixture times are relative offsets (see eventbrite-test.ts).
const NOW = new Date();
const hoursIso = (h: number): string => {
  // Funcheap publishes offset-qualified Pacific datetimes; emit the same
  // instant with an explicit -07:00/-08:00-agnostic UTC form is fine for the
  // parser, but mimic their format by using the raw ISO with offset Z->+00:00.
  return new Date(NOW.getTime() + h * 3_600_000).toISOString();
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FUNCHEAP TEST FAIL: ${message}`);
}

function archivePage(events: unknown[]): string {
  return `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"CollectionPage","name":"Yoast noise"}</script>
<script type="application/ld+json">${JSON.stringify(events)}</script>
</head><body></body></html>`;
}

const day0Events = [
  {
    "@type": "Event",
    name: "$1 Wing Wednesdays at Underdogs Cantina (SoMa)",
    description: "Wings and happy hour by the ballpark. FREE (No Cover).",
    startDate: hoursIso(6),
    endDate: hoursIso(10),
    url: "https://sf.funcheap.example/wing-wednesdays/",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: "Underdogs Cantina", address: "128 King St., San Francisco, CA" },
    offers: { url: "https://tickets.example/wings", price: 0 },
  },
  {
    "@type": "Event",
    name: "Secret Jazz in the Panhandle",
    description: "Surprise brass band concert.",
    startDate: hoursIso(8),
    url: "https://sf.funcheap.example/secret-jazz/",
    location: { "@type": "Place", name: "Panhandle", address: "Fell St & Baker St, SF, CA 94117" },
    offers: { price: "10" },
  },
  {
    "@type": "Event",
    name: "Oakland First Fridays",
    description: "Street festival.",
    startDate: hoursIso(9),
    url: "https://sf.funcheap.example/oakland-ff/",
    location: { "@type": "Place", name: "Telegraph Ave", address: "Telegraph Ave, Oakland, CA" },
    offers: { price: 0 },
  },
  {
    "@type": "Event",
    name: "Cancelled Trivia Night",
    startDate: hoursIso(7),
    url: "https://sf.funcheap.example/trivia/",
    eventStatus: "https://schema.org/EventCancelled",
    location: { "@type": "Place", name: "A Bar", address: "San Francisco, CA" },
  },
];

const day1Events = [
  {
    "@type": "Event",
    name: "Free Museum Day at the Mint (94103)",
    description: "Museum doors open, no charge.",
    startDate: hoursIso(30),
    url: "https://sf.funcheap.example/mint-free-day/",
    location: { "@type": "Place", name: "The Old Mint", address: "88 5th St, San Francisco, CA 94103" },
    offers: { price: 0 },
  },
  {
    "@type": "Event",
    name: "Mystery Event With No Price",
    startDate: hoursIso(32),
    url: "https://sf.funcheap.example/mystery/",
    location: { "@type": "Place", name: "Somewhere", address: "San Francisco" },
  },
  {
    "@type": "Event",
    name: "Free &#8220;Entity&#8221; Night &#038; Sing-Along",
    startDate: hoursIso(33),
    url: "https://sf.funcheap.example/entities/",
    location: { "@type": "Place", name: "The Function", address: "SF" },
    offers: { price: 0 },
  },
];

let fetchCount = 0;
const fakeFetch: FetchLike = async (rawUrl) => {
  const url = new URL(rawUrl);
  fetchCount++;
  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /search/\n", { status: 200 });
  }
  const m = url.pathname.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/$/);
  assert(m, `unexpected path ${url.pathname}`);
  // First requested day serves day0, second serves day1, rest 404 (no events).
  const dayIndex = pageOrder.indexOf(url.pathname);
  if (dayIndex === 0) return new Response(archivePage(day0Events), { status: 200 });
  if (dayIndex === 1) return new Response(archivePage(day1Events), { status: 200 });
  return new Response("not found", { status: 404 });
};
const pageOrder: string[] = [];
const trackingFetch: FetchLike = async (rawUrl, init) => {
  const url = new URL(rawUrl);
  if (/^\/\d{4}\/\d{2}\/\d{2}\/$/.test(url.pathname) && !pageOrder.includes(url.pathname)) {
    pageOrder.push(url.pathname);
  }
  return fakeFetch(rawUrl, init);
};

const CONFIG: FuncheapConfig = { baseUrl: "https://sf.funcheap.example", maxDaysOut: 4 };

async function main(): Promise<void> {
  // --- Units ---
  assert(inferCategory("Stand-Up Comedy Showcase") === "comedy", "comedy inference");
  assert(inferCategory("Free Jazz Concert in the Park") === "live_music", "music inference");
  assert(inferCategory("Some Lecture") === "art_culture", "default category");
  assert(neighborhoodFromTitle("Wing Night (SoMa)") === "SoMa", "paren neighborhood");
  assert(neighborhoodFromTitle("Wing Night (Berkeley)") === undefined, "unknown paren ignored");

  // --- Adapter ---
  const adapter = new FuncheapAdapter(CONFIG, trackingFetch);
  const result = await adapter.fetch(NOW);

  assert(pageOrder.length === 4, `must fetch one archive page per day (got ${pageOrder.length})`);
  assert(result.offers.length === 5, `expected 5 listings, got ${result.offers.length}`);

  const entity = result.offers.find((o) => o.title.includes("Entity"));
  assert(
    entity?.title === "Free “Entity” Night & Sing-Along",
    `HTML entities must decode, got '${entity?.title}'`,
  );

  const wings = result.offers.find((o) => o.title.startsWith("$1 Wing"));
  assert(wings, "wings event missing");
  assert(wings.priceCents === 0 && !wings.priceUnknown, "offers.price 0 must be Free");
  assert(wings.neighborhood === "SoMa", `title paren -> SoMa, got ${wings.neighborhood}`);
  assert(wings.category === "food_drink", `wings -> food_drink, got ${wings.category}`);
  assert(wings.sourceUrl === "https://sf.funcheap.example/wing-wednesdays/", "sourceUrl must be the Funcheap page");
  assert(wings.terms.includes("https://tickets.example/wings"), "ticket URL preserved in terms");

  const jazz = result.offers.find((o) => o.title.startsWith("Secret Jazz"));
  assert(jazz?.priceCents === 1000 && !jazz.priceUnknown, "string price '10' -> $10.00");
  assert(jazz?.category === "live_music", "jazz -> live_music");

  const mint = result.offers.find((o) => o.title.startsWith("Free Museum"));
  assert(mint?.neighborhood === "SoMa", `zip 94103 -> SoMa, got ${mint?.neighborhood}`);

  const mystery = result.offers.find((o) => o.title.startsWith("Mystery"));
  assert(mystery?.priceUnknown === true, "no offers -> priceUnknown");

  const reasons = result.skipped.map((s) => s.reason);
  assert(reasons.some((r) => r.startsWith("outside SF")), "Oakland event must be region-filtered");
  assert(reasons.some((r) => r.startsWith("status EventCancelled")), "cancelled event skipped");
  assert(reasons.filter((r) => r === "HTTP 404").length === 2, "empty days reported as 404s");
  console.log("adapter: 4 listings across 2 days; region filter, pricing, neighborhoods, categories correct");

  // --- Stable IDs + ingest ---
  const rerun = await adapter.fetch(NOW);
  assert(
    result.offers.map((o) => o.id).sort().join() === rerun.offers.map((o) => o.id).sort().join(),
    "IDs stable across syncs",
  );
  const store = new InMemoryOfferStore(NOW, { seed: false });
  const first = await runListingIngest(store, [adapter], NOW);
  const second = await runListingIngest(store, [adapter], NOW);
  assert(first.totalUpserted === 5 && second.totalUpserted === 5 && second.merged === 0, "re-sync upserts in place");

  const free = store.searchOffers({ maxPrice: 0, limit: 10, offset: 0 }, NOW);
  assert(free.offers.length === 3, `max_price=0 should return the 3 free SF events, got ${free.offers.length}`);
  console.log("store: stable IDs, in-place re-sync, free-event search returns curated freebies");

  console.log("\nFUNCHEAP TEST OK — archive crawling, mapping, region filter, and ingest all pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

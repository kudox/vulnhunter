/**
 * ICS feed adapter test: canned iCalendar feeds through a fake fetch.
 * Covers line unfolding, text unescaping, TZID/UTC/floating datetimes,
 * all-day and cancelled skips, DURATION parsing, weekly RRULE expansion with
 * EXDATE and COUNT, unsupported-RRULE skips, LOCATION zip extraction,
 * assumeFree pricing, webcal normalization, and stable IDs.
 *
 *   npm run test:ics
 */

import { IcsFeedAdapter, type IcsAdapterConfig } from "../src/services/adapters/icsFeeds.js";
import { expandRRule, parseIcsDuration, parseRRule, unfoldIcs } from "../src/services/ics.js";
import type { FetchLike } from "../src/services/eventbrite.js";
import { runListingIngest } from "../src/services/ingest.js";
import { InMemoryOfferStore } from "../src/store/store.js";

// Real clock; fixture times are relative offsets (see eventbrite-test.ts).
const NOW = new Date();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ICS TEST FAIL: ${message}`);
}

/** Format a Date as a floating ICS datetime in America/Los_Angeles wall-clock. */
function icsLocal(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}T${(Number(parts.hour) % 24).toString().padStart(2, "0")}${parts.minute}00`;
}

function icsUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

const hours = (h: number): Date => new Date(NOW.getTime() + h * 3_600_000);

// Weekly recurring event: started 2 weeks ago, Tuesdays+Thursdays... keep it
// simple and deterministic: weekly on dtstart's weekday, started 14 days ago,
// so 2 occurrences land in the next 14 days; one is EXDATEd.
const recurStart = new Date(hours(-14 * 24 + 2).getTime()); // 14 days ago +2h
const firstUpcoming = new Date(recurStart.getTime() + 14 * 86_400_000);
const secondUpcoming = new Date(recurStart.getTime() + 21 * 86_400_000);

const communityFeed = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:evt-solder@noisehall.example",
  // Folded SUMMARY line + escaped comma. Unfolding strips CRLF + ONE
  // whitespace char, so the real space needs a second leading space.
  "SUMMARY:Learn to Solder\\, Together — free",
  "  workshop",
  `DTSTART;TZID=America/Los_Angeles:${icsLocal(hours(26))}`,
  `DTEND;TZID=America/Los_Angeles:${icsLocal(hours(28))}`,
  "LOCATION:Noise Hall\\, 2169 Mission St\\, San Francisco\\, CA 94110",
  "DESCRIPTION:Bring a project or start one.\\nAll levels welcome.",
  "URL:https://noisehall.example/solder",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-recurring@noisehall.example",
  "SUMMARY:Weekly Open Hack Night",
  `DTSTART;TZID=America/Los_Angeles:${icsLocal(recurStart)}`,
  "DURATION:PT3H",
  "RRULE:FREQ=WEEKLY",
  `EXDATE;TZID=America/Los_Angeles:${icsLocal(secondUpcoming)}`,
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-allday@noisehall.example",
  "SUMMARY:All-Day Fair",
  "DTSTART;VALUE=DATE:20261010",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-cancelled@noisehall.example",
  "SUMMARY:Cancelled Thing",
  `DTSTART;TZID=America/Los_Angeles:${icsLocal(hours(30))}`,
  "STATUS:CANCELLED",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-monthly@noisehall.example",
  "SUMMARY:Monthly Board Meeting",
  `DTSTART;TZID=America/Los_Angeles:${icsLocal(hours(40))}`,
  "RRULE:FREQ=MONTHLY;BYDAY=2TU",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const utcFeed = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:evt-utc@meetgroup.example",
  "SUMMARY:Vector Databases in Anger",
  `DTSTART:${icsUtc(hours(50))}`,
  `DTEND:${icsUtc(hours(52))}`,
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-past@meetgroup.example",
  "SUMMARY:Already Happened",
  `DTSTART:${icsUtc(hours(-5))}`,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const fakeFetch: FetchLike = async (rawUrl) => {
  const url = new URL(rawUrl);
  assert(url.protocol === "https:", "webcal:// must be normalized to https");
  if (url.hostname === "noisehall.example") return new Response(communityFeed, { status: 200 });
  if (url.hostname === "meetgroup.example") return new Response(utcFeed, { status: 200 });
  if (url.hostname === "dead.example") return new Response("nope", { status: 410 });
  throw new Error(`unexpected fetch: ${rawUrl}`);
};

const CONFIG: IcsAdapterConfig = {
  feeds: [
    { url: "webcal://noisehall.example/public/basic.ics", name: "Noise Hall", category: "art_culture", assumeFree: true },
    { url: "https://meetgroup.example/events/ical/", name: "Meet Group" },
    { url: "https://dead.example/cal.ics", name: "Dead Feed" },
  ],
  maxDaysOut: 14,
};

async function main(): Promise<void> {
  // --- Units ---
  assert(unfoldIcs("SUMMARY:one\r\n two\r\nURL:x") === "SUMMARY:onetwo\r\nURL:x", "line unfolding strips CRLF + one WSP");
  assert(parseIcsDuration("PT3H") === 3 * 3_600_000, "PT3H duration");
  assert(parseIcsDuration("P1DT2H30M") === (26.5 * 3_600_000), "P1DT2H30M duration");
  const weekly = parseRRule("FREQ=WEEKLY;INTERVAL=1", "America/Los_Angeles");
  assert(!("unsupported" in weekly), "weekly RRULE must parse");
  const monthly = parseRRule("FREQ=MONTHLY;BYDAY=2TU", "America/Los_Angeles");
  assert("unsupported" in monthly, "monthly RRULE must be reported unsupported");
  const expanded = expandRRule(
    new Date("2026-01-06T04:00:00Z"),
    { freq: "WEEKLY", interval: 1, count: 3 },
    new Date("2026-03-01T00:00:00Z"),
    new Set(),
  );
  assert(expanded.length === 3, `COUNT=3 must yield 3 occurrences, got ${expanded.length}`);
  console.log("units: unfolding, durations, RRULE parse/expand");

  // --- Adapter ---
  const adapter = new IcsFeedAdapter(CONFIG, fakeFetch);
  const result = await adapter.fetch(NOW);

  const titles = result.offers.map((o) => o.title);
  const solder = result.offers.find((o) => o.title.startsWith("Learn to Solder"));
  assert(solder, `solder workshop missing from ${titles}`);
  assert(solder.title === "Learn to Solder, Together — free workshop", `unfold+unescape failed: '${solder.title}'`);
  assert(solder.priceCents === 0 && !solder.priceUnknown, "assumeFree feed events must be Free");
  assert(solder.neighborhood === "Mission", `LOCATION zip 94110 -> Mission, got ${solder.neighborhood}`);
  assert(solder.sourceUrl === "https://noisehall.example/solder", "URL prop must be sourceUrl");
  assert(
    solder.endsAt.getTime() - solder.startsAt.getTime() === 2 * 3_600_000,
    "DTEND must set duration",
  );

  const hacks = result.offers.filter((o) => o.title === "Weekly Open Hack Night");
  assert(
    hacks.length === 1,
    `weekly recurrence: expected 1 upcoming occurrence (second EXDATEd), got ${hacks.length}`,
  );
  assert(
    Math.abs(hacks[0].startsAt.getTime() - firstUpcoming.getTime()) < 3_600_000 + 1,
    `occurrence should be ~${firstUpcoming.toISOString()}, got ${hacks[0].startsAt.toISOString()}`,
  );
  assert(
    hacks[0].endsAt.getTime() - hacks[0].startsAt.getTime() === 3 * 3_600_000,
    "DURATION:PT3H must apply to occurrences",
  );

  const utcEvent = result.offers.find((o) => o.title === "Vector Databases in Anger");
  assert(utcEvent, "UTC-datetime event missing");
  assert(utcEvent.priceUnknown === true, "non-assumeFree feed must be priceUnknown");

  const reasons = result.skipped.map((s) => s.reason);
  assert(reasons.includes("date-only start (all-day)"), "all-day event must be skipped");
  assert(reasons.includes("status CANCELLED"), "cancelled event must be skipped");
  assert(reasons.some((r) => r.includes("FREQ=MONTHLY")), "monthly RRULE skip must be reported");
  assert(reasons.includes("no occurrences in window"), "past event must be skipped");
  assert(reasons.includes("HTTP 410"), "dead feed must be reported");
  console.log(`adapter: ${result.offers.length} listings; skips: all-day, cancelled, monthly-RRULE, past, dead feed`);

  // --- Stable IDs + ingest round-trip ---
  const rerun = await adapter.fetch(NOW);
  assert(
    result.offers.map((o) => o.id).sort().join() === rerun.offers.map((o) => o.id).sort().join(),
    "IDs must be stable across syncs",
  );
  const store = new InMemoryOfferStore(NOW, { seed: false });
  const first = await runListingIngest(store, [adapter], NOW);
  const second = await runListingIngest(store, [adapter], NOW);
  assert(
    first.totalUpserted === second.totalUpserted && second.merged === 0,
    "re-sync must upsert in place",
  );

  const freeSearch = store.searchOffers({ maxPrice: 0, limit: 10, offset: 0 }, NOW);
  assert(
    freeSearch.offers.some((o) => o.title.startsWith("Learn to Solder")),
    "max_price=0 must surface free ICS events",
  );
  console.log("store: stable IDs, in-place re-sync, free-event search works");

  console.log("\nICS TEST OK — parser, recurrence, pricing, skips, and ingest all pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

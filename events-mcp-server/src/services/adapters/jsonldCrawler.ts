import { createHash } from "node:crypto";
import type { Category, Merchant, Offer } from "../../types.js";
import type { FetchLike } from "../eventbrite.js";
import { neighborhoodForZip } from "../neighborhoods.js";
import type { AdapterResult, SourceAdapter } from "./types.js";
import type { VenuePage } from "./venues.js";

/**
 * Schema.org JSON-LD venue crawler — OSINT source #2.
 *
 * Venue and ticketing pages embed `Event` structured data (they publish it
 * for Google), so one generic parser covers every venue on the seed list.
 * Politeness: robots.txt is checked per host, requests carry an identifiable
 * User-Agent, venues are fetched sequentially, and one venue failing never
 * sinks the rest.
 *
 * Source naming: `jsonld:<hostname>` — precedence matches on the `jsonld`
 * prefix (venue's own site: above aggregators, below ticketing APIs).
 */

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "EventsBot/0.1 (local events aggregation; respects robots.txt)";
/** Schema.org Event subtypes we recognize, mapped to the events server categories. */
const EVENT_TYPE_CATEGORY: Record<string, Category | undefined> = {
  Event: undefined, // generic — fall back to venue config
  MusicEvent: "live_music",
  ComedyEvent: "comedy",
  TheaterEvent: "theater",
  DanceEvent: "theater",
  VisualArtsEvent: "art_culture",
  ExhibitionEvent: "art_culture",
  ScreeningEvent: "art_culture",
  Festival: "live_music",
  FoodEvent: "food_drink",
  SportsEvent: "sports",
  EducationEvent: "art_culture",
  SocialEvent: "art_culture",
};

// --- Loose shapes for the JSON-LD we consume (real-world data is messy) ---

interface LdOffer {
  price?: string | number;
  lowPrice?: string | number;
  priceCurrency?: string;
  url?: string;
}

interface LdPlace {
  name?: string;
  address?:
    | string
    | {
        streetAddress?: string;
        postalCode?: string;
        addressLocality?: string;
      };
}

interface LdEvent {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  eventStatus?: string;
  location?: LdPlace | LdPlace[];
  offers?: LdOffer | LdOffer[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Naive JSON-LD datetimes (a Live Nation quirk: "2026-07-31T20:00:00" with no
// offset) are interpreted in the venue's timezone — see services/dates.ts.
export { parseEventDate } from "../dates.js";
import { parseEventDate } from "../dates.js";

/** Extract every JSON-LD block from an HTML document. Regex is fine here:
 * we only need script tag bodies, not a DOM. */
export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scriptRe =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD is common in the wild; skip the block, keep the page.
    }
  }
  return blocks;
}

/** Walk a JSON-LD document (@graph, arrays, ItemList nesting) collecting Events. */
export function collectEvents(node: unknown, out: LdEvent[] = []): LdEvent[] {
  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, out);
    return out;
  }
  if (node === null || typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;

  const types = asArray(obj["@type"] as string | string[] | undefined);
  if (types.some((t) => t in EVENT_TYPE_CATEGORY)) {
    out.push(obj as LdEvent);
  }
  // Recurse into common containers.
  for (const key of ["@graph", "itemListElement", "item", "event", "events", "subEvent"]) {
    if (obj[key] !== undefined) collectEvents(obj[key], out);
  }
  return out;
}

function categoryFor(event: LdEvent, fallback: Category | undefined): Category {
  for (const type of asArray(event["@type"])) {
    const mapped = EVENT_TYPE_CATEGORY[type];
    if (mapped) return mapped;
  }
  return fallback ?? "art_culture";
}

function parsePriceCents(event: LdEvent): { priceCents: number; priceUnknown: boolean } {
  for (const offer of asArray(event.offers)) {
    const raw = offer.lowPrice ?? offer.price;
    if (raw === undefined || raw === null || raw === "") continue;
    if (offer.priceCurrency && offer.priceCurrency.toUpperCase() !== "USD") continue;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(value) && value >= 0) {
      return { priceCents: Math.round(value * 100), priceUnknown: false };
    }
  }
  return { priceCents: 0, priceUnknown: true };
}

/** Stable listing ID from host + event identity, so re-syncs upsert in place. */
function listingId(host: string, event: LdEvent): string {
  const identity = `${host}|${event.url ?? event.name ?? ""}|${event.startDate ?? ""}`;
  return `off_jl_${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
}

/** Map one JSON-LD event from a venue page to a listing. Pure. */
export function mapLdEventToListing(
  event: LdEvent,
  venue: VenuePage,
  host: string,
  now: Date,
  maxDaysOut: number,
  timezone: string,
): { offer: Offer; merchant: Merchant } | { skip: string } {
  const title = event.name?.trim();
  if (!title) return { skip: "no event name" };
  if (!event.startDate) return { skip: "no start date" };
  // Date-only starts ("2026-08-01") are all-day/TBA; don't invent a time.
  if (!event.startDate.includes("T")) return { skip: "date-only start (no time)" };
  if (event.eventStatus && /Cancelled|Postponed/i.test(event.eventStatus)) {
    return { skip: `status ${event.eventStatus.split("/").pop()}` };
  }

  const startsAt = parseEventDate(event.startDate, timezone);
  if (!startsAt) return { skip: "unparseable start date" };
  if (startsAt.getTime() <= now.getTime()) return { skip: "already started" };
  if (startsAt.getTime() > now.getTime() + maxDaysOut * 86_400_000) {
    return { skip: `starts more than ${maxDaysOut} days out` };
  }
  const endsAt =
    (event.endDate ? parseEventDate(event.endDate, timezone) : undefined) ??
    new Date(startsAt.getTime() + 3 * 3_600_000);

  const location = asArray(event.location)[0];
  const address = typeof location?.address === "object" ? location.address : undefined;
  const zip = address?.postalCode?.trim().slice(0, 5);
  const neighborhood =
    (zip && neighborhoodForZip(zip)) ||
    venue.neighborhood ||
    address?.addressLocality?.trim() ||
    "San Francisco";
  const category = categoryFor(event, venue.category);
  const { priceCents, priceUnknown } = parsePriceCents(event);

  // Event URLs are often relative; resolve against the venue page.
  let sourceUrl: string | undefined;
  try {
    sourceUrl = event.url ? new URL(event.url, venue.url).toString() : venue.url;
  } catch {
    sourceUrl = venue.url;
  }

  const merchant: Merchant = {
    id: `mer_jl_${createHash("sha256").update(host).digest("hex").slice(0, 10)}`,
    name: location?.name?.trim() || venue.name,
    category,
    neighborhood,
    address: address?.streetAddress?.trim() || "",
    description: `Events published on ${host} (venue website structured data).`,
  };

  const offer: Offer = {
    id: listingId(host, event),
    kind: "listing",
    source: `jsonld:${host}`,
    sourceUrl,
    sources: [`jsonld:${host}`],
    priceUnknown,
    merchantId: merchant.id,
    title,
    description: (event.description?.trim() || `Listed on ${venue.name}'s website.`).slice(0, 300),
    category,
    neighborhood,
    startsAt,
    endsAt,
    claimDeadline: startsAt,
    priceCents,
    faceValueCents: priceCents,
    totalQuantity: 0,
    remainingQuantity: 0,
    minPartySize: 1,
    maxPartySize: 99,
    newCustomersOnly: false,
    sponsored: false,
    terms: `Informational listing from the venue's website — tickets at the source, not through this server.${sourceUrl ? ` Details: ${sourceUrl}` : ""}`,
  };

  return { offer, merchant };
}

/** Minimal robots.txt check: honor `Disallow` rules in `User-agent: *` groups. */
export function isPathAllowedByRobots(robotsTxt: string, path: string): boolean {
  let inStarGroup = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    switch (field.trim().toLowerCase()) {
      case "user-agent":
        inStarGroup = value === "*";
        break;
      case "disallow":
        if (inStarGroup && value !== "" && path.startsWith(value)) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

export interface JsonLdCrawlerConfig {
  venues: VenuePage[];
  maxDaysOut: number;
  /** Timezone applied to timezone-naive datetimes (default: venue-local SF). */
  timezone?: string;
}

export class JsonLdCrawlerAdapter implements SourceAdapter {
  readonly name = "jsonld";
  private readonly config: JsonLdCrawlerConfig;
  private readonly fetchFn: FetchLike;
  private readonly robotsCache = new Map<string, string>();

  constructor(config: JsonLdCrawlerConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  private async robotsFor(origin: string): Promise<string> {
    const cached = this.robotsCache.get(origin);
    if (cached !== undefined) return cached;
    let robots = "";
    try {
      const response = await this.fetchFn(`${origin}/robots.txt`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) robots = await response.text();
    } catch {
      // Unreachable robots.txt -> treat as allow-all, same as browsers/crawlers do.
    }
    this.robotsCache.set(origin, robots);
    return robots;
  }

  async fetch(now: Date): Promise<AdapterResult> {
    const merchants = new Map<string, Merchant>();
    const offersById = new Map<string, Offer>();
    const skipped: AdapterResult["skipped"] = [];

    for (const venue of this.config.venues) {
      const venueUrl = new URL(venue.url);
      try {
        const robots = await this.robotsFor(venueUrl.origin);
        if (!isPathAllowedByRobots(robots, venueUrl.pathname)) {
          skipped.push({ id: venue.url, reason: "disallowed by robots.txt" });
          continue;
        }

        const response = await this.fetchFn(venue.url, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          skipped.push({ id: venue.url, reason: `HTTP ${response.status}` });
          continue;
        }

        const events = extractJsonLdBlocks(await response.text()).flatMap((block) =>
          collectEvents(block),
        );
        if (events.length === 0) {
          skipped.push({ id: venue.url, reason: "no JSON-LD events on page" });
          continue;
        }

        const timezone = this.config.timezone ?? "America/Los_Angeles";
        for (const event of events) {
          const result = mapLdEventToListing(event, venue, venueUrl.hostname, now, this.config.maxDaysOut, timezone);
          if ("skip" in result) {
            skipped.push({ id: `${venueUrl.hostname}:${event.name ?? "?"}`, reason: result.skip });
          } else {
            merchants.set(result.merchant.id, result.merchant);
            offersById.set(result.offer.id, result.offer);
          }
        }
      } catch (error) {
        skipped.push({
          id: venue.url,
          reason: `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return { merchants: [...merchants.values()], offers: [...offersById.values()], skipped };
  }
}

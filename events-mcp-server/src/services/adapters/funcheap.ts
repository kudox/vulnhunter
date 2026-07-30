import { createHash } from "node:crypto";
import { NEIGHBORHOODS } from "../../constants.js";
import type { Category, Merchant, Offer } from "../../types.js";
import { parseEventDate } from "../dates.js";
import type { FetchLike } from "../eventbrite.js";
import { decodeHtmlEntities } from "../text.js";
import { neighborhoodForZip } from "../neighborhoods.js";
import { collectEvents, extractJsonLdBlocks, isPathAllowedByRobots } from "./jsonldCrawler.js";
import type { AdapterResult, SourceAdapter } from "./types.js";

/**
 * Funcheap SF adapter — OSINT source #4, the curated free/cheap layer.
 *
 * Funcheap's date-archive pages (sf.funcheap.com/YYYY/MM/DD/) embed full
 * schema.org Event JSON-LD — ~2 dozen editor-curated events per day with
 * explicit `offers.price` (0 = free), offset-qualified datetimes, and venue
 * addresses. So this adapter is a thin loop over the next N daily pages,
 * reusing the JSON-LD crawler's extraction; no brittle HTML parsing.
 *
 * Politeness: robots.txt honored (it only disallows /search/), identifiable
 * UA, one page per day per sync. Attribution: listings link to the Funcheap
 * event page — they run on traffic, and we send it.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "EventsBot/0.1 (local events aggregation; respects robots.txt)";
const TZ = "America/Los_Angeles";

export interface FuncheapConfig {
  baseUrl: string;
  maxDaysOut: number;
}

export function funcheapConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FuncheapConfig | undefined {
  if (env.EVENTS_FUNCHEAP !== "on") return undefined;
  return {
    baseUrl: env.EVENTS_FUNCHEAP_BASE ?? "https://sf.funcheap.com",
    maxDaysOut: Number(env.EVENTS_LISTING_MAX_DAYS_OUT ?? "14") || 14,
  };
}

/** Y/M/D of an instant in Pacific time, for building archive URLs. */
function pacificDateParts(date: Date): { y: string; m: string; d: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { y: parts.year, m: parts.month, d: parts.day };
}

/** Keyword heuristic — Funcheap's JSON-LD carries no category field. */
export function inferCategory(text: string): Category {
  const t = text.toLowerCase();
  const rules: Array<[Category, RegExp]> = [
    ["comedy", /\bcomedy|comedian|stand[- ]?up|improv\b/],
    ["live_music", /\bconcert|band|dj|music|jazz|symphony|orchestra|karaoke|vinyl\b/],
    ["theater", /\btheater|theatre|play|musical|ballet|dance performance|opera\b/],
    ["fitness", /\byoga|fitness|run\b|\bhike|climb|skate|bike ride\b/],
    ["wellness", /\bmeditation|sauna|wellness|sound bath\b/],
    ["food_drink", /\bfood|wine|beer|taco|wings?\b|happy hour|brunch|tasting|oyster|cocktail/],
    ["sports", /\bgiants|warriors|49ers|soccer|baseball|basketball\b/],
  ];
  for (const [category, re] of rules) if (re.test(t)) return category;
  return "art_culture";
}

/** Funcheap titles end with "(Neighborhood)" — match against our known set. */
export function neighborhoodFromTitle(title: string): string | undefined {
  const paren = title.match(/\(([^()]+)\)\s*$/)?.[1]?.trim();
  if (!paren) return undefined;
  return NEIGHBORHOODS.find((n) => n.toLowerCase() === paren.toLowerCase());
}

interface FcJsonLdEvent {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  eventStatus?: string;
  location?: { name?: string; address?: string | { streetAddress?: string } } | Array<{
    name?: string;
    address?: string | { streetAddress?: string };
  }>;
  offers?: { price?: number | string; url?: string } | Array<{ price?: number | string; url?: string }>;
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Map one Funcheap JSON-LD event to a listing. Pure. */
export function mapFuncheapEvent(
  event: FcJsonLdEvent,
  now: Date,
  maxDaysOut: number,
): { offer: Offer; merchant: Merchant } | { skip: string } {
  const title = event.name ? decodeHtmlEntities(event.name).trim() : undefined;
  if (!title) return { skip: "no event name" };
  if (!event.startDate?.includes("T")) return { skip: "no timed start" };
  if (event.eventStatus && /Cancelled|Postponed/i.test(event.eventStatus)) {
    return { skip: `status ${event.eventStatus.split("/").pop()}` };
  }

  const startsAt = parseEventDate(event.startDate, TZ);
  if (!startsAt) return { skip: "unparseable start date" };
  if (startsAt.getTime() <= now.getTime()) return { skip: "already started" };
  if (startsAt.getTime() > now.getTime() + maxDaysOut * 86_400_000) {
    return { skip: `starts more than ${maxDaysOut} days out` };
  }
  const endsAt =
    (event.endDate ? parseEventDate(event.endDate, TZ) : undefined) ??
    new Date(startsAt.getTime() + 3 * 3_600_000);

  const location = first(event.location);
  const address = decodeHtmlEntities(
    typeof location?.address === "string"
      ? location.address
      : location?.address?.streetAddress ?? "",
  );

  // Funcheap's Bay Area coverage spans regions; keep San Francisco proper.
  if (address && !/san francisco|(?:^|[\s,])sf(?:[\s,.]|$)/i.test(address)) {
    return { skip: `outside SF (${address.slice(0, 40)})` };
  }

  const zip = address.match(/\b(941\d{2})\b/)?.[1];
  const neighborhood =
    (zip && neighborhoodForZip(zip)) || neighborhoodFromTitle(title) || "San Francisco";
  const category = inferCategory(`${title} ${event.description ?? ""}`);

  const offers = first(event.offers);
  const rawPrice = offers?.price;
  const price =
    typeof rawPrice === "number" ? rawPrice : rawPrice !== undefined ? Number(rawPrice) : undefined;
  const priceKnown = price !== undefined && Number.isFinite(price) && price >= 0;

  const venueName = location?.name ? decodeHtmlEntities(location.name).trim() : "Venue TBA";
  const merchant: Merchant = {
    id: `mer_fc_${createHash("sha256").update(venueName.toLowerCase()).digest("hex").slice(0, 10)}`,
    name: venueName,
    category,
    neighborhood,
    address: address.slice(0, 120),
    description: "Venue appearing in Funcheap SF's curated event listings.",
  };

  const sourceUrl = event.url ?? "https://sf.funcheap.com/";
  const ticketUrl = offers?.url;
  const offer: Offer = {
    id: `off_fc_${createHash("sha256").update(`${sourceUrl}|${startsAt.toISOString()}`).digest("hex").slice(0, 12)}`,
    kind: "listing",
    source: "funcheap",
    sourceUrl,
    sources: ["funcheap"],
    priceUnknown: !priceKnown,
    merchantId: merchant.id,
    title,
    description: (event.description ? decodeHtmlEntities(event.description).trim() : "Curated by Funcheap SF.").slice(0, 300),
    category,
    neighborhood,
    startsAt,
    endsAt,
    claimDeadline: startsAt,
    priceCents: priceKnown ? Math.round(price * 100) : 0,
    faceValueCents: priceKnown ? Math.round(price * 100) : 0,
    totalQuantity: 0,
    remainingQuantity: 0,
    minPartySize: 1,
    maxPartySize: 99,
    newCustomersOnly: false,
    sponsored: false,
    terms: `Informational listing curated by Funcheap SF — details at the source, not through this server. ${sourceUrl}${ticketUrl ? ` Tickets: ${ticketUrl}` : ""}`,
  };
  return { offer, merchant };
}

export class FuncheapAdapter implements SourceAdapter {
  readonly name = "funcheap";
  private readonly config: FuncheapConfig;
  private readonly fetchFn: FetchLike;

  constructor(config: FuncheapConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async fetch(now: Date): Promise<AdapterResult> {
    const merchants = new Map<string, Merchant>();
    const offersById = new Map<string, Offer>();
    const skipped: AdapterResult["skipped"] = [];
    const base = new URL(this.config.baseUrl);

    let robots = "";
    try {
      const res = await this.fetchFn(`${base.origin}/robots.txt`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) robots = await res.text();
    } catch {
      // Unreachable robots.txt -> allow, as elsewhere.
    }

    for (let day = 0; day < this.config.maxDaysOut; day++) {
      const { y, m, d } = pacificDateParts(new Date(now.getTime() + day * 86_400_000));
      const path = `/${y}/${m}/${d}/`;
      if (!isPathAllowedByRobots(robots, path)) {
        skipped.push({ id: path, reason: "disallowed by robots.txt" });
        continue;
      }
      try {
        const response = await this.fetchFn(`${base.origin}${path}`, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          skipped.push({ id: path, reason: `HTTP ${response.status}` });
          continue;
        }
        const events = extractJsonLdBlocks(await response.text()).flatMap((b) =>
          collectEvents(b),
        ) as FcJsonLdEvent[];
        for (const event of events) {
          const result = mapFuncheapEvent(event, now, this.config.maxDaysOut);
          if ("skip" in result) {
            skipped.push({ id: `${path}${event.name?.slice(0, 40) ?? "?"}`, reason: result.skip });
          } else {
            merchants.set(result.merchant.id, result.merchant);
            offersById.set(result.offer.id, result.offer);
          }
        }
      } catch (error) {
        skipped.push({
          id: path,
          reason: `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return { merchants: [...merchants.values()], offers: [...offersById.values()], skipped };
  }
}

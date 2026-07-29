import type { Category, Merchant, Offer } from "../../types.js";
import type { FetchLike } from "../eventbrite.js";
import { neighborhoodForZip } from "../neighborhoods.js";
import type { AdapterResult, SourceAdapter } from "./types.js";

/**
 * Ticketmaster Discovery API adapter — the first OSINT listing source.
 *
 * Unlike Eventbrite, Discovery has genuinely public search: city/date/
 * classification queries, free tier 5,000 calls/day at 5 req/s (a metro sync
 * uses a handful). Docs: developer.ticketmaster.com. Everything ingested here
 * becomes a non-claimable `listing` that links out to Ticketmaster.
 */

const API_BASE = "https://app.ticketmaster.com/discovery/v2";
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
// Discovery API rejects deep paging past item 1000; stay well under.
const MAX_PAGES = 5;

interface TmImage {
  url?: string;
}

interface TmVenue {
  id: string;
  name?: string;
  postalCode?: string;
  city?: { name?: string };
  address?: { line1?: string };
}

interface TmEvent {
  id: string;
  name?: string;
  url?: string;
  info?: string;
  description?: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string };
    end?: { dateTime?: string };
    status?: { code?: string };
  };
  priceRanges?: Array<{ type?: string; currency?: string; min?: number; max?: number }>;
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
  }>;
  images?: TmImage[];
  _embedded?: { venues?: TmVenue[] };
}

interface TmEventsPage {
  _embedded?: { events?: TmEvent[] };
  page?: { totalPages?: number; number?: number };
}

/** Ticketmaster segment/genre -> LastCall category. */
function categoryFor(event: TmEvent): Category {
  const classification = event.classifications?.[0];
  if (classification?.genre?.name?.toLowerCase() === "comedy") return "comedy";
  switch (classification?.segment?.name) {
    case "Music":
      return "live_music";
    case "Arts & Theatre":
      return "theater";
    case "Sports":
      return "sports";
    default:
      return "art_culture";
  }
}

export interface TmMarket {
  city: string;
  stateCode: string;
}

export interface TicketmasterConfig {
  apiKey: string;
  /** City markets to sync, each queried separately. */
  markets: TmMarket[];
  /** Ignore events starting further out than this many days. */
  maxDaysOut: number;
}

const DEFAULT_MARKETS: TmMarket[] = [
  { city: "San Francisco", stateCode: "CA" },
  { city: "Sacramento", stateCode: "CA" },
];

/** Parse "San Francisco,CA;Sacramento,CA"-style TICKETMASTER_MARKETS. */
function parseMarkets(raw: string): TmMarket[] {
  return raw
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [city, stateCode] = pair.split(",").map((s) => s.trim());
      return { city, stateCode: stateCode || "CA" };
    })
    .filter((m) => m.city);
}

export function ticketmasterConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TicketmasterConfig | undefined {
  if (!env.TICKETMASTER_API_KEY) return undefined;
  let markets = DEFAULT_MARKETS;
  if (env.TICKETMASTER_MARKETS) {
    markets = parseMarkets(env.TICKETMASTER_MARKETS);
  } else if (env.TICKETMASTER_CITY) {
    // Single-market override kept for compatibility.
    markets = [{ city: env.TICKETMASTER_CITY, stateCode: env.TICKETMASTER_STATE_CODE ?? "CA" }];
  }
  if (markets.length === 0) return undefined;
  return {
    apiKey: env.TICKETMASTER_API_KEY,
    markets,
    maxDaysOut: Number(env.LASTCALL_LISTING_MAX_DAYS_OUT ?? "14") || 14,
  };
}

/** ISO 8601 without milliseconds, which is what Discovery's date params require. */
function tmIso(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * Map one Discovery event to a listing, or explain the skip. Pure.
 */
export function mapTmEventToListing(
  event: TmEvent,
  now: Date,
  maxDaysOut: number,
): { offer: Offer; merchant: Merchant } | { skip: string } {
  const startIso = event.dates?.start?.dateTime;
  if (!startIso) return { skip: "no concrete start time" }; // date-only TBA events
  if (event.dates?.status?.code && event.dates.status.code !== "onsale") {
    return { skip: `status ${event.dates.status.code}` };
  }

  const startsAt = new Date(startIso);
  if (startsAt.getTime() <= now.getTime()) return { skip: "already started" };
  if (startsAt.getTime() > now.getTime() + maxDaysOut * 86_400_000) {
    return { skip: `starts more than ${maxDaysOut} days out` };
  }
  const endsAt = event.dates?.end?.dateTime
    ? new Date(event.dates.end.dateTime)
    : new Date(startsAt.getTime() + 3 * 3_600_000);

  const venue = event._embedded?.venues?.[0];
  const zip = venue?.postalCode?.trim().slice(0, 5);
  const neighborhood =
    (zip && neighborhoodForZip(zip)) || venue?.city?.name?.trim() || "San Francisco";

  const standardRange =
    event.priceRanges?.find((r) => r.type === "standard") ?? event.priceRanges?.[0];
  const minPrice = standardRange?.min;
  const priceKnown = typeof minPrice === "number" && minPrice >= 0;

  const merchant: Merchant = {
    id: venue?.id ? `mer_tm_venue_${venue.id}` : `mer_tm_unknown`,
    name: venue?.name?.trim() || "Venue TBA",
    category: categoryFor(event),
    neighborhood,
    address: venue?.address?.line1?.trim() || "",
    description: "Venue listing synced from Ticketmaster.",
  };

  const offer: Offer = {
    id: `off_tm_${event.id}`,
    kind: "listing",
    source: "ticketmaster",
    sourceUrl: event.url,
    sources: ["ticketmaster"],
    priceUnknown: !priceKnown,
    merchantId: merchant.id,
    title: event.name?.trim() || `Event ${event.id}`,
    description: (event.info || event.description || "Listed on Ticketmaster.").slice(0, 300),
    category: categoryFor(event),
    neighborhood,
    startsAt,
    endsAt,
    // Listings aren't claimable; they simply stop appearing at showtime.
    claimDeadline: startsAt,
    priceCents: priceKnown ? Math.round(minPrice * 100) : 0,
    faceValueCents: priceKnown ? Math.round(minPrice * 100) : 0,
    totalQuantity: 0,
    remainingQuantity: 0,
    minPartySize: 1,
    maxPartySize: 99,
    newCustomersOnly: false,
    sponsored: false,
    terms: `Informational listing from Ticketmaster — tickets are sold at the source, not through LastCall.${event.url ? ` Buy at: ${event.url}` : ""}`,
  };

  return { offer, merchant };
}

export class TicketmasterAdapter implements SourceAdapter {
  readonly name = "ticketmaster";
  private readonly config: TicketmasterConfig;
  private readonly fetchFn: FetchLike;

  constructor(config: TicketmasterConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  private async getPage(market: TmMarket, page: number, now: Date): Promise<TmEventsPage> {
    const url = new URL(`${API_BASE}/events.json`);
    url.searchParams.set("apikey", this.config.apiKey);
    url.searchParams.set("city", market.city);
    url.searchParams.set("stateCode", market.stateCode);
    url.searchParams.set("startDateTime", tmIso(now));
    url.searchParams.set(
      "endDateTime",
      tmIso(new Date(now.getTime() + this.config.maxDaysOut * 86_400_000)),
    );
    url.searchParams.set("sort", "date,asc");
    url.searchParams.set("size", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));

    const response = await this.fetchFn(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "Ticketmaster rejected the API key. Check TICKETMASTER_API_KEY — get one free at developer.ticketmaster.com.",
        );
      }
      if (response.status === 429) {
        throw new Error("Ticketmaster rate limit hit (5 req/s, 5000/day). Retry later.");
      }
      throw new Error(`Ticketmaster API request failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as TmEventsPage;
  }

  async fetch(now: Date): Promise<AdapterResult> {
    const merchants = new Map<string, Merchant>();
    const offersById = new Map<string, Offer>();
    const skipped: AdapterResult["skipped"] = [];

    for (const market of this.config.markets) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await this.getPage(market, page, now);
        for (const event of body._embedded?.events ?? []) {
          const result = mapTmEventToListing(event, now, this.config.maxDaysOut);
          if ("skip" in result) {
            skipped.push({ id: event.id, reason: result.skip });
          } else {
            merchants.set(result.merchant.id, result.merchant);
            offersById.set(result.offer.id, result.offer);
          }
        }
        const totalPages = body.page?.totalPages ?? 1;
        if (page + 1 >= totalPages) break;
      }
    }

    return { merchants: [...merchants.values()], offers: [...offersById.values()], skipped };
  }
}

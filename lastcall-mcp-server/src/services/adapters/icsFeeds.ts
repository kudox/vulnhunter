import { createHash } from "node:crypto";
import type { Merchant, Offer } from "../../types.js";
import type { FetchLike } from "../eventbrite.js";
import {
  expandRRule,
  isDateOnly,
  parseIcsDateTime,
  parseIcsDuration,
  parseIcsEvents,
  parseRRule,
  prop,
  propAll,
  unescapeIcsText,
  type IcsEvent,
} from "../ics.js";
import { neighborhoodForZip } from "../neighborhoods.js";
import type { AdapterResult, SourceAdapter } from "./types.js";
import type { IcsFeed } from "./icsFeedList.js";

/**
 * ICS/iCal feed adapter — OSINT source #3, the free civic-event layer.
 *
 * Published calendar feeds (Google Calendar public ICS, Meetup group iCal,
 * library/city calendars) are explicitly machine-readable, extremely stable,
 * and skew toward exactly the free community events no ticketing API carries.
 * Recurring events (weekly workshops, monthly socials) are expanded via
 * limited RRULE support in services/ics.ts.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "LastCallBot/0.1 (local events aggregation; respects robots.txt)";
const DEFAULT_TZ = "America/Los_Angeles";
const DEFAULT_DURATION_MS = 2 * 3_600_000;

function normalizeFeedUrl(url: string): string {
  // Calendar apps hand out webcal:// subscription URLs; it's HTTP underneath.
  return url.replace(/^webcal:\/\//i, "https://");
}

export interface IcsAdapterConfig {
  feeds: IcsFeed[];
  maxDaysOut: number;
}

interface MappedEvent {
  offer: Offer;
  merchant: Merchant;
}

/** Map one VEVENT (expanding recurrence) to listings. Pure. */
export function mapIcsEvent(
  event: IcsEvent,
  feed: IcsFeed,
  host: string,
  now: Date,
  maxDaysOut: number,
): MappedEvent[] | { skip: string } {
  const summary = prop(event, "SUMMARY");
  const title = summary ? unescapeIcsText(summary.value).trim() : "";
  if (!title) return { skip: "no SUMMARY" };

  const status = prop(event, "STATUS")?.value.trim().toUpperCase();
  if (status === "CANCELLED") return { skip: "status CANCELLED" };

  const dtstartProp = prop(event, "DTSTART");
  if (!dtstartProp) return { skip: "no DTSTART" };
  if (isDateOnly(dtstartProp)) return { skip: "date-only start (all-day)" };

  const timezone = feed.timezone ?? DEFAULT_TZ;
  const dtstart = parseIcsDateTime(dtstartProp, timezone);
  if (!dtstart) return { skip: "unparseable DTSTART" };

  // Duration: DTEND wins, then DURATION, then a default.
  let durationMs = DEFAULT_DURATION_MS;
  const dtendProp = prop(event, "DTEND");
  if (dtendProp && !isDateOnly(dtendProp)) {
    const dtend = parseIcsDateTime(dtendProp, timezone);
    if (dtend && dtend.getTime() > dtstart.getTime()) durationMs = dtend.getTime() - dtstart.getTime();
  } else {
    const duration = prop(event, "DURATION");
    const parsed = duration ? parseIcsDuration(duration.value) : undefined;
    if (parsed && parsed > 0) durationMs = parsed;
  }

  // Occurrences: single, or RRULE-expanded within the horizon.
  const horizonEnd = new Date(now.getTime() + maxDaysOut * 86_400_000);
  let occurrences: Date[];
  const rruleProp = prop(event, "RRULE");
  if (rruleProp) {
    const rule = parseRRule(rruleProp.value, timezone);
    if ("unsupported" in rule) return { skip: rule.unsupported };
    const exdates = new Set<number>();
    for (const ex of propAll(event, "EXDATE")) {
      for (const value of ex.value.split(",")) {
        const parsed = parseIcsDateTime({ ...ex, value }, timezone);
        if (parsed) exdates.add(parsed.getTime());
      }
    }
    occurrences = expandRRule(dtstart, rule, horizonEnd, exdates);
  } else {
    occurrences = [dtstart];
  }
  occurrences = occurrences.filter(
    (o) => o.getTime() > now.getTime() && o.getTime() <= horizonEnd.getTime(),
  );
  if (occurrences.length === 0) return { skip: "no occurrences in window" };

  const location = prop(event, "LOCATION") ? unescapeIcsText(prop(event, "LOCATION")!.value).trim() : "";
  const venueName = location.split(",")[0]?.trim() || feed.name;
  const zip = location.match(/\b(941\d{2})\b/)?.[1];
  const neighborhood =
    (zip && neighborhoodForZip(zip)) || feed.neighborhood || "San Francisco";

  const url = prop(event, "URL")?.value.trim() || normalizeFeedUrl(feed.url);
  const description = prop(event, "DESCRIPTION")
    ? unescapeIcsText(prop(event, "DESCRIPTION")!.value).trim().slice(0, 300)
    : `From the ${feed.name} calendar.`;
  const uid = prop(event, "UID")?.value.trim() || title;
  const category = feed.category ?? "art_culture";

  const merchant: Merchant = {
    id: `mer_ics_${createHash("sha256").update(`${host}|${feed.name}`).digest("hex").slice(0, 10)}`,
    name: feed.name,
    category,
    neighborhood,
    address: location.slice(0, 120),
    description: `Events from the ${feed.name} public calendar (${host}).`,
  };

  return occurrences.map((startsAt) => ({
    merchant,
    offer: {
      id: `off_ics_${createHash("sha256").update(`${host}|${uid}|${startsAt.toISOString()}`).digest("hex").slice(0, 12)}`,
      kind: "listing",
      source: `ics:${host}`,
      sourceUrl: url,
      sources: [`ics:${host}`],
      priceUnknown: !feed.assumeFree,
      merchantId: merchant.id,
      title,
      description,
      category,
      neighborhood,
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMs),
      claimDeadline: startsAt,
      priceCents: 0,
      faceValueCents: 0,
      totalQuantity: 0,
      remainingQuantity: 0,
      minPartySize: 1,
      maxPartySize: 99,
      newCustomersOnly: false,
      sponsored: false,
      terms: `Informational listing from the ${feed.name} public calendar — details at the source, not through LastCall. ${url}`,
    },
  }));
}

export class IcsFeedAdapter implements SourceAdapter {
  readonly name = "ics";
  private readonly config: IcsAdapterConfig;
  private readonly fetchFn: FetchLike;

  constructor(config: IcsAdapterConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async fetch(now: Date): Promise<AdapterResult> {
    const merchants = new Map<string, Merchant>();
    const offersById = new Map<string, Offer>();
    const skipped: AdapterResult["skipped"] = [];

    for (const feed of this.config.feeds) {
      const feedUrl = normalizeFeedUrl(feed.url);
      const host = new URL(feedUrl).hostname;
      try {
        const response = await this.fetchFn(feedUrl, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/calendar, text/plain, */*" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          skipped.push({ id: feed.url, reason: `HTTP ${response.status}` });
          continue;
        }
        const body = await response.text();
        const events = parseIcsEvents(body);
        if (events.length === 0) {
          skipped.push({ id: feed.url, reason: "no VEVENTs in feed" });
          continue;
        }
        for (const event of events) {
          const result = mapIcsEvent(event, feed, host, now, this.config.maxDaysOut);
          if ("skip" in result) {
            const title = prop(event, "SUMMARY")?.value ?? "?";
            skipped.push({ id: `${host}:${title.slice(0, 40)}`, reason: result.skip });
          } else {
            for (const { merchant, offer } of result) {
              merchants.set(merchant.id, merchant);
              offersById.set(offer.id, offer);
            }
          }
        }
      } catch (error) {
        skipped.push({
          id: feed.url,
          reason: `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return { merchants: [...merchants.values()], offers: [...offersById.values()], skipped };
  }
}

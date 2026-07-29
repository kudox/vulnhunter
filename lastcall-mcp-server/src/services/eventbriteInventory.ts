import type { Category, Merchant, Offer } from "../types.js";
import type { EbEvent, EbOrganization, EbTicketClass, EventbriteClient } from "./eventbrite.js";
import { neighborhoodForZip } from "./neighborhoods.js";

/**
 * Promotion rules: how a merchant's raw Eventbrite inventory becomes LastCall
 * offers. These are the platform defaults; per-merchant rules ("25% off any
 * show under 60% sold within 48h, never Saturdays") are the roadmap version.
 */
export interface PromotionRule {
  /** Percent off face value applied to promoted events. */
  discountPct: number;
  /** Hours before start when claiming closes. */
  claimCutoffHours: number;
  /** Only promote events less than this fraction sold — well-selling events don't need us. */
  maxSoldRatio: number;
  /** Cap on spots released into a single promotion (merchant guardrail). */
  maxSpots: number;
  /** Ignore events starting further out than this. */
  maxDaysOut: number;
}

export const DEFAULT_PROMOTION_RULE: PromotionRule = {
  discountPct: 25,
  claimCutoffHours: 2,
  maxSoldRatio: 0.8,
  maxSpots: 40,
  maxDaysOut: 14,
};

export function promotionRuleFromEnv(env: NodeJS.ProcessEnv = process.env): PromotionRule {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    discountPct: num("LASTCALL_EB_DISCOUNT_PCT", DEFAULT_PROMOTION_RULE.discountPct),
    claimCutoffHours: num("LASTCALL_EB_CLAIM_CUTOFF_HOURS", DEFAULT_PROMOTION_RULE.claimCutoffHours),
    maxSoldRatio: num("LASTCALL_EB_MAX_SOLD_RATIO", DEFAULT_PROMOTION_RULE.maxSoldRatio),
    maxSpots: num("LASTCALL_EB_MAX_SPOTS", DEFAULT_PROMOTION_RULE.maxSpots),
    maxDaysOut: num("LASTCALL_EB_MAX_DAYS_OUT", DEFAULT_PROMOTION_RULE.maxDaysOut),
  };
}

/** Eventbrite top-level category IDs -> LastCall categories. */
const CATEGORY_MAP: Record<string, Category> = {
  "103": "live_music", // Music
  "104": "art_culture", // Film, Media & Entertainment
  "105": "theater", // Performing & Visual Arts
  "106": "art_culture", // Fashion & Beauty
  "107": "wellness", // Health & Wellness
  "108": "fitness", // Sports & Fitness
  "110": "food_drink", // Food & Drink
  "113": "art_culture", // Community & Culture
};

export interface EventbriteInventory {
  merchants: Merchant[];
  offers: Offer[];
}

export interface SkippedEvent {
  eventId: string;
  reason: string;
}

export interface MappingResult extends EventbriteInventory {
  skipped: SkippedEvent[];
}

function neighborhoodFor(event: EbEvent): string {
  const zip = event.venue?.address?.postal_code?.trim().slice(0, 5);
  const mapped = zip ? neighborhoodForZip(zip) : undefined;
  return mapped ?? (event.venue?.address?.city?.trim() || "San Francisco");
}

function categoryFor(event: EbEvent): Category {
  return CATEGORY_MAP[event.category_id ?? ""] ?? "art_culture";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Map one Eventbrite event (plus its ticket classes) to a LastCall offer,
 * or explain why it isn't promotable. Pure: all clock access via `now`.
 */
export function mapEventToOffer(
  event: EbEvent,
  ticketClasses: EbTicketClass[],
  merchantId: string,
  rule: PromotionRule,
  now: Date,
): { offer: Offer } | { skip: string } {
  if (!event.start?.utc || !event.end?.utc) return { skip: "missing start/end time" };

  const startsAt = new Date(event.start.utc);
  const endsAt = new Date(event.end.utc);
  const claimDeadline = new Date(startsAt.getTime() - rule.claimCutoffHours * 3_600_000);

  if (claimDeadline.getTime() <= now.getTime()) return { skip: "claim window already closed" };
  if (startsAt.getTime() > now.getTime() + rule.maxDaysOut * 86_400_000) {
    return { skip: `starts more than ${rule.maxDaysOut} days out` };
  }
  if (event.ticket_availability?.is_sold_out) return { skip: "sold out" };

  // Paid, visible ticket classes are the promotable inventory. Free/RSVP
  // events have nothing to discount (filling them is a roadmap problem).
  const paidClasses = ticketClasses.filter(
    (tc) => !tc.free && !tc.donation && !tc.hidden && (tc.cost?.value ?? 0) > 0,
  );

  let faceValueCents: number | undefined;
  let available: number | undefined;
  let soldRatio: number | undefined;

  if (paidClasses.length > 0) {
    faceValueCents = Math.min(...paidClasses.map((tc) => tc.cost!.value));
    const totals = paidClasses.filter(
      (tc) => typeof tc.quantity_total === "number" && tc.quantity_total > 0,
    );
    if (totals.length > 0) {
      const total = totals.reduce((sum, tc) => sum + (tc.quantity_total ?? 0), 0);
      const sold = totals.reduce((sum, tc) => sum + (tc.quantity_sold ?? 0), 0);
      available = Math.max(0, total - sold);
      soldRatio = total > 0 ? sold / total : undefined;
    }
  } else if ((event.ticket_availability?.minimum_ticket_price?.value ?? 0) > 0) {
    // Ticket classes unavailable (common on restricted tokens) — fall back to
    // the availability expansion's price floor and a conservative spot count.
    faceValueCents = event.ticket_availability!.minimum_ticket_price!.value;
    available = event.ticket_availability?.has_available_tickets ? rule.maxSpots : 0;
  }

  if (!faceValueCents || faceValueCents <= 0) return { skip: "free or unpriced event" };
  if (available === undefined || available <= 0) return { skip: "no available inventory" };
  if (soldRatio !== undefined && soldRatio >= rule.maxSoldRatio) {
    return { skip: `selling well (${Math.round(soldRatio * 100)}% sold) — no promotion needed` };
  }

  const title = event.name?.text?.trim() || `Event ${event.id}`;
  const summary = event.summary?.trim() || event.description?.text?.trim() || "";

  const offer: Offer = {
    id: `off_eb_${event.id}`,
    kind: "offer",
    source: "eventbrite",
    sourceUrl: event.url,
    sources: ["eventbrite"],
    merchantId,
    title: `${title} — ${rule.discountPct}% off, last-minute seats`,
    description: truncate(summary || "Last-minute availability released through LastCall.", 300),
    category: categoryFor(event),
    neighborhood: neighborhoodFor(event),
    startsAt,
    endsAt,
    claimDeadline,
    priceCents: Math.round(faceValueCents * (1 - rule.discountPct / 100)),
    faceValueCents,
    totalQuantity: Math.min(available, rule.maxSpots),
    remainingQuantity: Math.min(available, rule.maxSpots),
    minPartySize: 1,
    maxPartySize: 8,
    newCustomersOnly: false,
    sponsored: false,
    terms: `Sourced live from Eventbrite. Redemption code is honored at the door; tickets remain subject to the organizer's event terms.${event.url ? ` Event page: ${event.url}` : ""}`,
  };
  return { offer };
}

export function merchantFromEvent(event: EbEvent, org: EbOrganization): Merchant {
  const venue = event.venue;
  return {
    id: venue?.id ? `mer_eb_venue_${venue.id}` : `mer_eb_org_${org.id}`,
    name: venue?.name?.trim() || org.name || `Eventbrite organizer ${org.id}`,
    category: categoryFor(event),
    neighborhood: neighborhoodFor(event),
    address: venue?.address?.address_1?.trim() || "",
    description: `Events by ${org.name || "an Eventbrite organizer"} (synced from Eventbrite).`,
  };
}

/**
 * Map a full org sweep into inventory. Pure aside from the injected client
 * calls; safe to run repeatedly — offer/merchant IDs are stable across syncs.
 */
export async function buildEventbriteInventory(
  client: EventbriteClient,
  rule: PromotionRule,
  now: Date,
  organizationIds?: string[],
): Promise<MappingResult> {
  const merchants = new Map<string, Merchant>();
  const offers: Offer[] = [];
  const skipped: SkippedEvent[] = [];

  const orgs = await client.listOrganizations();
  const selectedOrgs =
    organizationIds && organizationIds.length > 0
      ? orgs.filter((o) => organizationIds.includes(o.id))
      : orgs;

  for (const org of selectedOrgs) {
    const events = await client.listLiveEvents(org.id);
    for (const event of events) {
      let ticketClasses: EbTicketClass[] = [];
      try {
        ticketClasses = await client.listTicketClasses(event.id);
      } catch {
        // Non-fatal: the mapper falls back to the ticket_availability expansion.
      }
      const merchant = merchantFromEvent(event, org);
      const result = mapEventToOffer(event, ticketClasses, merchant.id, rule, now);
      if ("skip" in result) {
        skipped.push({ eventId: event.id, reason: result.skip });
      } else {
        merchants.set(merchant.id, merchant);
        offers.push(result.offer);
      }
    }
  }

  return { merchants: [...merchants.values()], offers, skipped };
}

import { PLATFORM_FEE_PCT } from "./constants.js";
import type { Claim, Merchant, Offer } from "./types.js";
import { discountPct } from "./types.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function isoOrUndefined(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

/** Human-friendly relative time like "in 3h 20m" for markdown output. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diffMinutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (diffMinutes <= 0) return "now";
  const h = Math.floor(diffMinutes / 60);
  const m = diffMinutes % 60;
  if (h === 0) return `in ${m}m`;
  if (h < 48) return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  return `in ${Math.round(h / 24)} days`;
}

/** Structured offer summary used in search results and detail views. */
export function offerToJson(offer: Offer, merchant: Merchant | undefined) {
  return {
    id: offer.id,
    title: offer.title,
    merchant: merchant?.name ?? offer.merchantId,
    merchant_id: offer.merchantId,
    category: offer.category,
    neighborhood: offer.neighborhood,
    starts_at: offer.startsAt.toISOString(),
    ends_at: offer.endsAt.toISOString(),
    claim_deadline: offer.claimDeadline.toISOString(),
    price_per_person: dollars(offer.priceCents),
    face_value_per_person: dollars(offer.faceValueCents),
    discount_pct: discountPct(offer),
    remaining_spots: offer.remainingQuantity,
    party_size_min: offer.minPartySize,
    party_size_max: offer.maxPartySize,
    new_customers_only: offer.newCustomersOnly,
    sponsored: offer.sponsored,
  };
}

export function offerToMarkdown(offer: Offer, merchant: Merchant | undefined, now: Date): string {
  const lines = [
    `## ${offer.title}${offer.sponsored ? " · [SPONSORED]" : ""}`,
    `- **Where**: ${merchant?.name ?? offer.merchantId} — ${offer.neighborhood}`,
    `- **When**: starts ${relativeTime(offer.startsAt, now)} (${offer.startsAt.toISOString()})`,
    `- **Price**: ${dollars(offer.priceCents)}/person (was ${dollars(offer.faceValueCents)}, ${discountPct(offer)}% off)`,
    `- **Availability**: ${offer.remainingQuantity} spot(s) left · parties of ${offer.minPartySize}–${offer.maxPartySize}`,
    `- **Claim by**: ${relativeTime(offer.claimDeadline, now)} (${offer.claimDeadline.toISOString()})`,
  ];
  if (offer.newCustomersOnly) lines.push(`- **Note**: new customers only`);
  lines.push(`- **Offer ID**: \`${offer.id}\``);
  return lines.join("\n");
}

export function claimToJson(claim: Claim, offer: Offer | undefined) {
  const platformFeeCents = Math.round(claim.totalCents * (PLATFORM_FEE_PCT / 100));
  return {
    claim_id: claim.id,
    offer_id: claim.offerId,
    offer_title: offer?.title,
    status: claim.status,
    party_size: claim.partySize,
    redemption_code: claim.redemptionCode,
    hold_expires_at: claim.status === "held" ? claim.holdExpiresAt.toISOString() : undefined,
    confirmed_at: isoOrUndefined(claim.confirmedAt),
    total: dollars(claim.totalCents),
    // Fee split is what the merchant sees on their statement; surfacing it in
    // the scaffold keeps the business model visible end-to-end.
    platform_fee: dollars(platformFeeCents),
    merchant_net: dollars(claim.totalCents - platformFeeCents),
  };
}

/**
 * Wrap a tool payload in the standard MCP result shape, with both a text
 * rendering and structuredContent.
 */
export function toolResult(text: string, structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: structured,
  };
}

export function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

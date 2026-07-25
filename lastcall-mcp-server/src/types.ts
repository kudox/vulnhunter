import { CATEGORIES, NEIGHBORHOODS } from "./constants.js";

export type Category = (typeof CATEGORIES)[number];

/**
 * Free-form so external feeds (Eventbrite venues, etc.) can carry any
 * neighborhood or city name; NEIGHBORHOODS lists the curated set used by the
 * seed data and surfaced in tool docs.
 */
export type Neighborhood = string;
export type KnownNeighborhood = (typeof NEIGHBORHOODS)[number];

export interface Merchant {
  id: string;
  name: string;
  category: Category;
  neighborhood: Neighborhood;
  address: string;
  description: string;
}

export interface Offer {
  id: string;
  merchantId: string;
  title: string;
  description: string;
  category: Category;
  neighborhood: Neighborhood;
  /** When the event/experience starts. */
  startsAt: Date;
  /** When the event/experience ends. */
  endsAt: Date;
  /** Last moment an agent may claim this offer; after this the inventory is gone for good. */
  claimDeadline: Date;
  /** Promotional price per person, in cents. */
  priceCents: number;
  /** Regular (face) value per person, in cents. */
  faceValueCents: number;
  /** Total spots the merchant released into this promotion. */
  totalQuantity: number;
  /** Spots still available (decremented by active holds and confirmations). */
  remainingQuantity: number;
  minPartySize: number;
  maxPartySize: number;
  /** Merchant guardrail: offer only valid for first-time customers. */
  newCustomersOnly: boolean;
  /** Merchant paid for priority placement. Always disclosed in results. */
  sponsored: boolean;
  terms: string;
}

export type ClaimStatus = "held" | "confirmed" | "released" | "expired";

export interface Claim {
  id: string;
  offerId: string;
  partySize: number;
  status: ClaimStatus;
  /** When the hold lapses and seats return to the pool (only meaningful while status is "held"). */
  holdExpiresAt: Date;
  redemptionCode: string;
  /** Total promotional price for the whole party, in cents. */
  totalCents: number;
  createdAt: Date;
  confirmedAt?: Date;
}

export interface OfferSearchFilters {
  category?: Category;
  neighborhood?: Neighborhood;
  query?: string;
  partySize?: number;
  /** Maximum promotional price per person, in dollars. */
  maxPrice?: number;
  /** Only offers starting within this many hours from now. */
  withinHours?: number;
  startsAfter?: Date;
  startsBefore?: Date;
  minDiscountPct?: number;
  limit: number;
  offset: number;
}

export interface OfferSearchResult {
  offers: Offer[];
  total: number;
}

export type StoreErrorReason =
  | "not_found"
  | "sold_out"
  | "expired"
  | "party_size"
  | "invalid_state";

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: StoreErrorReason; message: string };

export function discountPct(offer: Offer): number {
  if (offer.faceValueCents <= 0) return 0;
  return Math.round((1 - offer.priceCents / offer.faceValueCents) * 100);
}

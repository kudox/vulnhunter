import { randomBytes } from "node:crypto";
import { HOLD_DURATION_MINUTES } from "../constants.js";
import type {
  Claim,
  Merchant,
  Offer,
  OfferSearchFilters,
  OfferSearchResult,
  StoreResult,
} from "../types.js";
import { discountPct } from "../types.js";
import { buildSeed } from "./seed.js";

/**
 * Storage interface for the LastCall marketplace.
 *
 * The scaffold ships an in-memory implementation seeded with demo data; a
 * production deployment swaps this for a Postgres-backed implementation with
 * the same contract (plus real transactional guarantees around holds).
 */
export interface OfferStore {
  searchOffers(filters: OfferSearchFilters, now?: Date): OfferSearchResult;
  getOffer(offerId: string): Offer | undefined;
  getMerchant(merchantId: string): Merchant | undefined;
  claimOffer(offerId: string, partySize: number, now?: Date): StoreResult<Claim>;
  getClaim(claimIdOrCode: string): Claim | undefined;
  confirmClaim(claimIdOrCode: string, now?: Date): StoreResult<Claim>;
  releaseClaim(claimIdOrCode: string, now?: Date): StoreResult<Claim>;
  /** Every stored offer/listing, unfiltered — used by ingest dedup as anchors. */
  allOffers(): Offer[];
  /**
   * Merge inventory from an external feed (e.g. an Eventbrite sync). Existing
   * offers with the same ID are refreshed in place; spots consumed by active
   * local holds/confirmations stay consumed.
   */
  upsertInventory(merchants: Merchant[], offers: Offer[]): void;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

function newRedemptionCode(): string {
  // Short, human-readable code the user can show at the door.
  return `LC-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export class InMemoryOfferStore implements OfferStore {
  private readonly merchants = new Map<string, Merchant>();
  private readonly offers = new Map<string, Offer>();
  private readonly claims = new Map<string, Claim>();
  private readonly claimsByCode = new Map<string, string>();

  constructor(now: Date = new Date(), options: { seed?: boolean } = {}) {
    if (options.seed ?? true) {
      const seed = buildSeed(now);
      for (const merchant of seed.merchants) this.merchants.set(merchant.id, merchant);
      for (const offer of seed.offers) this.offers.set(offer.id, offer);
    }
  }

  upsertInventory(merchants: Merchant[], offers: Offer[]): void {
    this.sweepExpiredHolds(new Date());
    for (const merchant of merchants) this.merchants.set(merchant.id, merchant);

    // Spots held or confirmed locally aren't reflected in the external feed's
    // availability, so subtract them when refreshing an existing offer.
    const activeClaimedByOffer = new Map<string, number>();
    for (const claim of this.claims.values()) {
      if (claim.status === "held" || claim.status === "confirmed") {
        activeClaimedByOffer.set(
          claim.offerId,
          (activeClaimedByOffer.get(claim.offerId) ?? 0) + claim.partySize,
        );
      }
    }

    for (const offer of offers) {
      const locallyClaimed = activeClaimedByOffer.get(offer.id) ?? 0;
      this.offers.set(offer.id, {
        ...offer,
        remainingQuantity: Math.max(0, offer.remainingQuantity - locallyClaimed),
      });
    }
  }

  /**
   * Lazily expire lapsed holds, returning their seats to the pool. Called at
   * the top of every public operation so availability is always current
   * without needing a background timer.
   */
  private sweepExpiredHolds(now: Date): void {
    for (const claim of this.claims.values()) {
      if (claim.status === "held" && claim.holdExpiresAt.getTime() <= now.getTime()) {
        claim.status = "expired";
        const offer = this.offers.get(claim.offerId);
        if (offer) {
          offer.remainingQuantity = Math.min(
            offer.totalQuantity,
            offer.remainingQuantity + claim.partySize,
          );
        }
      }
    }
  }

  searchOffers(filters: OfferSearchFilters, now: Date = new Date()): OfferSearchResult {
    this.sweepExpiredHolds(now);

    const queryTerms = filters.query
      ? filters.query.toLowerCase().split(/\s+/).filter(Boolean)
      : [];

    const matches = [...this.offers.values()].filter((offer) => {
      if (offer.claimDeadline.getTime() <= now.getTime()) return false;
      if (filters.claimableOnly && offer.kind !== "offer") return false;
      // Availability and party-size bounds only constrain claimable offers;
      // listings are informational and carry no managed inventory.
      if (offer.kind === "offer" && offer.remainingQuantity < (filters.partySize ?? 1)) {
        return false;
      }
      if (filters.category && offer.category !== filters.category) return false;
      if (
        filters.neighborhood &&
        offer.neighborhood.toLowerCase() !== filters.neighborhood.toLowerCase()
      ) {
        return false;
      }
      if (filters.partySize !== undefined && offer.kind === "offer") {
        if (filters.partySize < offer.minPartySize || filters.partySize > offer.maxPartySize) {
          return false;
        }
      }
      if (filters.maxPrice !== undefined) {
        // A price cap is a price cap: unknown-priced listings can't satisfy it.
        if (offer.priceUnknown) return false;
        if (offer.priceCents > filters.maxPrice * 100) return false;
      }
      if (
        filters.withinHours !== undefined &&
        offer.startsAt.getTime() > now.getTime() + filters.withinHours * 3_600_000
      ) {
        return false;
      }
      if (filters.startsAfter && offer.startsAt.getTime() < filters.startsAfter.getTime()) {
        return false;
      }
      if (filters.startsBefore && offer.startsAt.getTime() > filters.startsBefore.getTime()) {
        return false;
      }
      if (filters.minDiscountPct !== undefined && discountPct(offer) < filters.minDiscountPct) {
        return false;
      }
      if (queryTerms.length > 0) {
        const merchant = this.merchants.get(offer.merchantId);
        const haystack = [
          offer.title,
          offer.description,
          merchant?.name ?? "",
          merchant?.description ?? "",
          offer.neighborhood,
          offer.category,
        ]
          .join(" ")
          .toLowerCase();
        if (!queryTerms.every((term) => haystack.includes(term))) return false;
      }
      return true;
    });

    // Ranking: deeper discounts and closer claim deadlines score higher.
    // Sponsored offers get a bounded boost and are always labeled as such in
    // results — placement is sellable, honesty about it is not negotiable.
    // Listings rank on urgency alone (free ones get a nudge), so claimable
    // offers generally lead without listings being buried.
    const score = (offer: Offer): number => {
      const hoursToDeadline = (offer.claimDeadline.getTime() - now.getTime()) / 3_600_000;
      const urgency = Math.max(0, 24 - hoursToDeadline);
      if (offer.kind === "listing") {
        const freeBoost = offer.priceCents === 0 && !offer.priceUnknown ? 8 : 0;
        return urgency + freeBoost;
      }
      return discountPct(offer) + urgency + (offer.sponsored ? 15 : 0);
    };

    matches.sort((a, b) => score(b) - score(a));

    return {
      offers: matches.slice(filters.offset, filters.offset + filters.limit),
      total: matches.length,
    };
  }

  getOffer(offerId: string): Offer | undefined {
    this.sweepExpiredHolds(new Date());
    return this.offers.get(offerId);
  }

  getMerchant(merchantId: string): Merchant | undefined {
    return this.merchants.get(merchantId);
  }

  allOffers(): Offer[] {
    return [...this.offers.values()];
  }

  claimOffer(offerId: string, partySize: number, now: Date = new Date()): StoreResult<Claim> {
    this.sweepExpiredHolds(now);

    const offer = this.offers.get(offerId);
    if (!offer) {
      return {
        ok: false,
        reason: "not_found",
        message: `No offer found with id '${offerId}'. Use lastcall_search_offers to find current offers.`,
      };
    }
    if (offer.kind !== "offer") {
      return {
        ok: false,
        reason: "invalid_state",
        message: `'${offer.title}' is an informational listing, not a claimable offer. Direct the user to the source instead${offer.sourceUrl ? `: ${offer.sourceUrl}` : "."}`,
      };
    }
    if (offer.claimDeadline.getTime() <= now.getTime()) {
      return {
        ok: false,
        reason: "expired",
        message: `Offer '${offer.title}' closed for claims at ${offer.claimDeadline.toISOString()}. Search again for offers that are still open.`,
      };
    }
    if (partySize < offer.minPartySize || partySize > offer.maxPartySize) {
      return {
        ok: false,
        reason: "party_size",
        message: `Offer '${offer.title}' accepts parties of ${offer.minPartySize}–${offer.maxPartySize}; requested ${partySize}.`,
      };
    }
    if (offer.remainingQuantity < partySize) {
      return {
        ok: false,
        reason: "sold_out",
        message: `Only ${offer.remainingQuantity} spot(s) left on '${offer.title}' — not enough for a party of ${partySize}.`,
      };
    }

    offer.remainingQuantity -= partySize;

    const claim: Claim = {
      id: newId("clm"),
      offerId: offer.id,
      partySize,
      status: "held",
      holdExpiresAt: new Date(now.getTime() + HOLD_DURATION_MINUTES * 60_000),
      redemptionCode: newRedemptionCode(),
      totalCents: offer.priceCents * partySize,
      createdAt: now,
    };
    this.claims.set(claim.id, claim);
    this.claimsByCode.set(claim.redemptionCode, claim.id);

    return { ok: true, value: claim };
  }

  getClaim(claimIdOrCode: string): Claim | undefined {
    this.sweepExpiredHolds(new Date());
    const byCode = this.claimsByCode.get(claimIdOrCode.toUpperCase());
    return this.claims.get(byCode ?? claimIdOrCode);
  }

  confirmClaim(claimIdOrCode: string, now: Date = new Date()): StoreResult<Claim> {
    this.sweepExpiredHolds(now);

    const claim = this.getClaimRaw(claimIdOrCode);
    if (!claim) {
      return {
        ok: false,
        reason: "not_found",
        message: `No claim found for '${claimIdOrCode}'. Pass the claim_id or redemption code returned by lastcall_claim_offer.`,
      };
    }
    if (claim.status === "confirmed") {
      // Idempotent: confirming twice returns the same receipt.
      return { ok: true, value: claim };
    }
    if (claim.status === "expired" || claim.status === "released") {
      return {
        ok: false,
        reason: "invalid_state",
        message: `Claim ${claim.id} is ${claim.status}; its seats went back to the pool. Claim the offer again if it's still available.`,
      };
    }

    claim.status = "confirmed";
    claim.confirmedAt = now;
    return { ok: true, value: claim };
  }

  releaseClaim(claimIdOrCode: string, now: Date = new Date()): StoreResult<Claim> {
    this.sweepExpiredHolds(now);

    const claim = this.getClaimRaw(claimIdOrCode);
    if (!claim) {
      return {
        ok: false,
        reason: "not_found",
        message: `No claim found for '${claimIdOrCode}'.`,
      };
    }
    if (claim.status !== "held") {
      return {
        ok: false,
        reason: "invalid_state",
        message: `Claim ${claim.id} is ${claim.status} and cannot be released. Only active holds can be released.`,
      };
    }

    claim.status = "released";
    const offer = this.offers.get(claim.offerId);
    if (offer) {
      offer.remainingQuantity = Math.min(
        offer.totalQuantity,
        offer.remainingQuantity + claim.partySize,
      );
    }
    return { ok: true, value: claim };
  }

  private getClaimRaw(claimIdOrCode: string): Claim | undefined {
    const byCode = this.claimsByCode.get(claimIdOrCode.toUpperCase());
    return this.claims.get(byCode ?? claimIdOrCode);
  }

  /**
   * Re-attach a claim persisted by a previous process (boot hydration).
   * Decrements inventory when the offer is already present; offers arriving
   * in later syncs are handled by upsertInventory's active-claims deduction.
   */
  restoreClaim(claim: Claim): void {
    if (this.claims.has(claim.id)) return;
    this.claims.set(claim.id, { ...claim });
    this.claimsByCode.set(claim.redemptionCode, claim.id);
    if (claim.status === "held" || claim.status === "confirmed") {
      const offer = this.offers.get(claim.offerId);
      if (offer) {
        offer.remainingQuantity = Math.max(0, offer.remainingQuantity - claim.partySize);
      }
    }
  }
}

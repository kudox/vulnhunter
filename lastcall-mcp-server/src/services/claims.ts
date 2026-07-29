import { PLATFORM_FEE_PCT } from "../constants.js";
import type { OfferStore } from "../store/store.js";
import type { Claim, StoreResult } from "../types.js";
import type { LastcallDb } from "./db.js";

/**
 * ClaimCoordinator — the claim/confirm/release mutation path, safe across
 * multiple server instances sharing one database.
 *
 * Without a database it delegates straight to the in-memory store (single
 * process is race-free — JS is single-threaded). With one, Postgres is the
 * claim AUTHORITY:
 *
 *  - claim: the local store validates and optimistically holds, then the
 *    seats are reserved atomically in Postgres (conditional UPDATE under a
 *    row lock + claim INSERT, one transaction). If Postgres refuses —
 *    another instance got the seats first — the local hold is rolled back
 *    and the caller sees an honest sold-out. If Postgres is unreachable,
 *    the claim FAILS: never trade oversell-safety for availability.
 *  - confirm/release: resolved locally first; a claim created by another
 *    instance is fetched from Postgres and adopted into the local store
 *    before proceeding, so any instance can complete any claim.
 *  - expiry: lapsed holds are swept in Postgres (each hold exactly once,
 *    row-locked) before every reserve, returning seats to the shared pool.
 */
export class ClaimCoordinator {
  constructor(
    private readonly store: OfferStore,
    private readonly db?: LastcallDb,
  ) {}

  async claim(offerId: string, partySize: number): Promise<StoreResult<Claim>> {
    // Local first: validates offer existence/kind/deadline/party bounds and
    // produces the claim (id, code) with good error messages.
    const local = this.store.claimOffer(offerId, partySize);
    if (!local.ok || !this.db) return local;

    const claim = local.value;
    const offer = this.store.getOffer(offerId);
    if (!offer) {
      this.store.releaseClaim(claim.id);
      return { ok: false, reason: "not_found", message: `Offer '${offerId}' vanished mid-claim; search again.` };
    }

    try {
      await this.db.sweepExpiredHolds();
      const reserved = await this.db.reserveAndInsertClaim(claim, offer);
      if (!reserved.ok) {
        this.store.releaseClaim(claim.id);
        return {
          ok: false,
          reason: "sold_out",
          message: `Only ${reserved.remaining} spot(s) left on '${offer.title}' across all of LastCall — not enough for a party of ${partySize}.`,
        };
      }
      return local;
    } catch (error) {
      this.store.releaseClaim(claim.id);
      console.error("claim reservation failed (claim rolled back):", error);
      return {
        ok: false,
        reason: "invalid_state",
        message: "The reservation system is temporarily unavailable — the hold was not placed. Try again shortly.",
      };
    }
  }

  async confirm(claimIdOrCode: string): Promise<StoreResult<Claim>> {
    await this.adoptIfForeign(claimIdOrCode);
    const result = this.store.confirmClaim(claimIdOrCode);
    if (result.ok && this.db) {
      const claim = result.value;
      const offer = this.store.getOffer(claim.offerId);
      const feeCents = Math.round(claim.totalCents * (PLATFORM_FEE_PCT / 100));
      this.db.saveClaim(claim, offer, feeCents).catch((error) => {
        console.error(`persisting confirmation ${claim.id} failed (will retry on next mutation):`, error);
      });
    }
    return result;
  }

  async release(claimIdOrCode: string): Promise<StoreResult<Claim>> {
    await this.adoptIfForeign(claimIdOrCode);
    const result = this.store.releaseClaim(claimIdOrCode);
    if (result.ok && this.db) {
      this.db.releaseClaimAndSeats(result.value).catch((error) => {
        console.error(`persisting release ${result.value.id} failed:`, error);
      });
    }
    return result;
  }

  /**
   * A claim unknown locally may belong to another instance: fetch it from
   * Postgres and adopt it into the local store so the operation can proceed.
   */
  private async adoptIfForeign(claimIdOrCode: string): Promise<void> {
    if (!this.db) return;
    if (this.store.getClaim(claimIdOrCode)) return;
    try {
      const foreign = await this.db.findClaim(claimIdOrCode);
      if (foreign) this.store.restoreClaim(foreign);
    } catch (error) {
      console.error(`cross-instance claim lookup for '${claimIdOrCode}' failed:`, error);
    }
  }
}

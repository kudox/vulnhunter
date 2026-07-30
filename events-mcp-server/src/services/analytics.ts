import type { Merchant, Offer } from "../types.js";
import type { EventsDb, SearchLogEntry, SnapshotRow } from "./db.js";
import { composeFingerprint, snapshotRowFromOffer } from "./db.js";

/**
 * Analytics + durability side-channel. Every method is fire-and-forget and
 * failure-isolated: a database hiccup logs to stderr and never breaks
 * serving. With no database configured, everything is a no-op — dev and the
 * fixture suites never need Postgres.
 */

/** The fields whose change makes a snapshot worth recording. */
export function snapshotFingerprint(offer: Offer): string {
  return composeFingerprint(
    offer.remainingQuantity,
    offer.totalQuantity,
    offer.priceCents,
    offer.priceUnknown ?? false,
    offer.startsAt.getTime(), // reschedules matter
    (offer.sources ?? [offer.source]).length, // new corroboration matters
  );
}

/**
 * Delta-only selection: returns rows for offers that are new to this process
 * or changed since their last recorded snapshot, and updates the fingerprint
 * cache. Pure aside from the cache it is handed.
 */
export function diffSnapshots(
  offers: Offer[],
  fingerprints: Map<string, string>,
  syncAt: Date,
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const offer of offers) {
    const fp = snapshotFingerprint(offer);
    if (fingerprints.get(offer.id) === fp) continue;
    fingerprints.set(offer.id, fp);
    rows.push(snapshotRowFromOffer(offer, syncAt));
  }
  return rows;
}

export class Analytics {
  private readonly db?: EventsDb;
  private readonly fingerprints = new Map<string, string>();

  constructor(db?: EventsDb) {
    this.db = db;
  }

  get enabled(): boolean {
    return this.db !== undefined;
  }

  /**
   * Load the last recorded fingerprint per event so delta-only recording
   * survives process boundaries — essential for one-shot scheduled workers,
   * useful on server restarts. Returns the number of primed events.
   */
  async primeFingerprints(): Promise<number> {
    if (!this.db) return 0;
    const latest = await this.db.loadLatestFingerprints();
    for (const [eventId, fp] of latest) {
      if (!this.fingerprints.has(eventId)) this.fingerprints.set(eventId, fp);
    }
    return latest.size;
  }

  private run(what: string, op: () => Promise<void>): void {
    if (!this.db) return;
    op().catch((error) => {
      console.error(`analytics: ${what} failed (serving unaffected):`, error);
    });
  }

  /** Record changed/new offers after a sync or a mutation. */
  recordEventSnapshots(offers: Offer[], syncAt: Date = new Date()): void {
    if (!this.db) return;
    const rows = diffSnapshots(offers, this.fingerprints, syncAt);
    if (rows.length === 0) return;
    this.run(`snapshot x${rows.length}`, () => this.db!.insertSnapshots(rows));
  }

  persistMerchants(merchants: Merchant[]): void {
    this.run(`merchants x${merchants.length}`, () => this.db!.upsertMerchants(merchants));
  }

  /**
   * Push feed-side availability baselines (pre-local-deduction) for
   * claimable offers into the shared inventory ledger.
   */
  syncInventoryBaselines(offers: Offer[]): void {
    const rows = offers
      .filter((o) => o.kind === "offer")
      .map((o) => ({ offerId: o.id, baseline: o.remainingQuantity }));
    if (rows.length === 0) return;
    this.run(`baselines x${rows.length}`, () => this.db!.updateInventoryBaselines(rows));
  }

  logSearch(entry: SearchLogEntry): void {
    this.run("search log", () => this.db!.insertSearchLog(entry));
  }
}

/** Shared default: a disabled Analytics that no-ops everywhere. */
export const NOOP_ANALYTICS = new Analytics();

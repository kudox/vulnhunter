import type { Merchant, Offer } from "../../types.js";

/**
 * A listing source adapter: fetches events from one external source and
 * returns them as normalized inventory. Adapters stay dumb — mapping rules,
 * dedup, and store writes live in the shared ingest pipeline.
 *
 * Contract notes:
 * - Returned offers should have `kind: "listing"` (claimable offers only come
 *   from merchant-connected integrations like the Eventbrite sync).
 * - IDs must be stable across runs (derive from the source's event IDs) so
 *   re-ingestion upserts instead of duplicating.
 * - Throwing fails that adapter's sync only; other adapters still run.
 */
export interface SourceAdapter {
  /** Source name used in provenance and precedence, e.g. "ticketmaster". */
  name: string;
  fetch(now: Date): Promise<AdapterResult>;
}

export interface AdapterResult {
  merchants: Merchant[];
  offers: Offer[];
  /** Events seen but not ingested, with reasons — the sync audit trail. */
  skipped: Array<{ id: string; reason: string }>;
}

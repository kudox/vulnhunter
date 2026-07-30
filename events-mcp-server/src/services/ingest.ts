import type { OfferStore } from "../store/store.js";
import type { Merchant } from "../types.js";
import { dedupeIncoming, type DedupRecord } from "./dedup.js";
import type { SourceAdapter } from "./adapters/types.js";

export interface IngestSummary {
  bySource: Array<{ source: string; ingested: number; skipped: number; error?: string }>;
  merged: number;
  totalUpserted: number;
}

/**
 * Run all listing adapters, dedupe across sources AND against what's already
 * in the store (so a Ticketmaster listing never shadows a claimable offer for
 * the same show), then upsert the survivors.
 *
 * One failing adapter doesn't sink the sync — its error is reported in the
 * summary and the rest proceed.
 */
export async function runListingIngest(
  store: OfferStore,
  adapters: SourceAdapter[],
  now: Date = new Date(),
): Promise<IngestSummary> {
  const bySource: IngestSummary["bySource"] = [];
  const incoming: DedupRecord[] = [];
  const merchantsById = new Map<string, Merchant>();

  for (const adapter of adapters) {
    try {
      const result = await adapter.fetch(now);
      for (const merchant of result.merchants) merchantsById.set(merchant.id, merchant);
      for (const offer of result.offers) {
        incoming.push({
          offer,
          venueName: merchantsById.get(offer.merchantId)?.name ?? "",
        });
      }
      bySource.push({
        source: adapter.name,
        ingested: result.offers.length,
        skipped: result.skipped.length,
      });
    } catch (error) {
      bySource.push({
        source: adapter.name,
        ingested: 0,
        skipped: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const anchors: DedupRecord[] = store
    .allOffers()
    // Only anchor on records not owned by these adapters — otherwise every
    // re-sync would drop its own previous batch as "duplicates". Sources may
    // be prefixed per origin ("jsonld:<host>"), so match on the prefix too.
    .filter(
      (offer) =>
        !adapters.some((a) => offer.source === a.name || offer.source.startsWith(`${a.name}:`)),
    )
    .map((offer) => ({
      offer,
      venueName: store.getMerchant(offer.merchantId)?.name ?? "",
    }));

  const { kept, merged } = dedupeIncoming(incoming, anchors);

  const usedMerchantIds = new Set(kept.map((offer) => offer.merchantId));
  const merchants = [...merchantsById.values()].filter((m) => usedMerchantIds.has(m.id));
  store.upsertInventory(merchants, kept);

  return { bySource, merged: merged.length, totalUpserted: kept.length };
}

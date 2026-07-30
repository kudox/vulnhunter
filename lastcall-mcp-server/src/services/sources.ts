import type { Analytics } from "./analytics.js";
import { FuncheapAdapter, funcheapConfigFromEnv } from "./adapters/funcheap.js";
import { IcsFeedAdapter } from "./adapters/icsFeeds.js";
import { CURATED_ICS_FEEDS } from "./adapters/icsFeedList.js";
import { JsonLdCrawlerAdapter } from "./adapters/jsonldCrawler.js";
import {
  TicketmasterAdapter,
  ticketmasterConfigFromEnv,
} from "./adapters/ticketmaster.js";
import type { SourceAdapter } from "./adapters/types.js";
import { CURATED_VENUE_PAGES } from "./adapters/venues.js";
import { EventbriteClient } from "./eventbrite.js";
import {
  buildEventbriteInventory,
  promotionRuleFromEnv,
} from "./eventbriteInventory.js";
import { runListingIngest } from "./ingest.js";
import type { OfferStore } from "../store/store.js";

/**
 * Shared source-sync logic: the long-running server (src/index.ts, interval
 * loops) and the one-shot sync worker (src/sync.ts, cron) run exactly these
 * functions — one code path, two schedulers.
 */

/** Build the listing adapters the environment enables. */
export function buildListingAdaptersFromEnv(env: NodeJS.ProcessEnv = process.env): SourceAdapter[] {
  const adapters: SourceAdapter[] = [];

  const tmConfig = ticketmasterConfigFromEnv(env);
  if (tmConfig) adapters.push(new TicketmasterAdapter(tmConfig));

  if (env.LASTCALL_JSONLD === "on") {
    const urls = env.LASTCALL_JSONLD_VENUES?.split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    const venues = urls
      ? urls.map((url) => ({ url, name: new URL(url).hostname }))
      : CURATED_VENUE_PAGES;
    const maxDaysOut = Number(env.LASTCALL_LISTING_MAX_DAYS_OUT ?? "14") || 14;
    adapters.push(new JsonLdCrawlerAdapter({ venues, maxDaysOut }));
  }

  if (env.LASTCALL_ICS === "on") {
    const urls = env.LASTCALL_ICS_FEEDS?.split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    const feeds = urls
      ? urls.map((url) => ({ url, name: new URL(url.replace(/^webcal:\/\//i, "https://")).hostname }))
      : CURATED_ICS_FEEDS;
    const maxDaysOut = Number(env.LASTCALL_LISTING_MAX_DAYS_OUT ?? "14") || 14;
    adapters.push(new IcsFeedAdapter({ feeds, maxDaysOut }));
  }

  const fcConfig = funcheapConfigFromEnv(env);
  if (fcConfig) adapters.push(new FuncheapAdapter(fcConfig));

  return adapters;
}

/**
 * One Eventbrite sync pass: ingest, baselines, snapshots. Returns a summary
 * line, or undefined when EVENTBRITE_API_TOKEN isn't configured.
 */
export async function syncEventbriteOnce(
  store: OfferStore,
  analytics: Analytics,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const token = env.EVENTBRITE_API_TOKEN;
  if (!token) return undefined;

  const client = new EventbriteClient(token);
  const rule = promotionRuleFromEnv(env);
  const orgIds = env.EVENTBRITE_ORG_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const syncAt = new Date();
  const result = await buildEventbriteInventory(client, rule, syncAt, orgIds);
  store.upsertInventory(result.merchants, result.offers);
  analytics.persistMerchants(result.merchants);
  // Pre-deduction feed availability -> shared inventory baselines.
  analytics.syncInventoryBaselines(result.offers);
  analytics.recordEventSnapshots(
    store.allOffers().filter((o) => o.source === "eventbrite"),
    syncAt,
  );
  return (
    `Eventbrite sync: ${result.offers.length} offer(s) from ${result.merchants.length} venue(s); skipped ${result.skipped.length} event(s)` +
    (result.skipped.length > 0
      ? ` (${result.skipped.map((s) => `${s.eventId}: ${s.reason}`).join("; ")})`
      : "")
  );
}

/** One listing-ingest pass across the given adapters: ingest, merchants, snapshots. */
export async function syncListingsOnce(
  store: OfferStore,
  analytics: Analytics,
  adapters: SourceAdapter[],
): Promise<string> {
  const syncAt = new Date();
  const summary = await runListingIngest(store, adapters, syncAt);
  const listings = store.allOffers().filter((o) => o.kind === "listing");
  analytics.recordEventSnapshots(listings, syncAt);
  analytics.persistMerchants(
    [...new Set(listings.map((o) => o.merchantId))]
      .map((id) => store.getMerchant(id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined),
  );
  const perSource = summary.bySource
    .map((s) => `${s.source}: ${s.error ? `ERROR ${s.error}` : `${s.ingested} in, ${s.skipped} skipped`}`)
    .join(" | ");
  return `Listing ingest: ${summary.totalUpserted} upserted, ${summary.merged} merged as duplicates — ${perSource}`;
}

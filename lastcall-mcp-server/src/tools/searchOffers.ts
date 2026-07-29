import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CATEGORIES,
  CHARACTER_LIMIT,
  CITY,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  NEIGHBORHOODS,
} from "../constants.js";
import { ResponseFormat, offerToJson, offerToMarkdown, toolError, toolResult } from "../format.js";
import type { Analytics } from "../services/analytics.js";
import type { OfferStore } from "../store/store.js";

const inputShape = {
  query: z
    .string()
    .max(200)
    .optional()
    .describe("Free-text search across offer titles, descriptions, and merchant names (e.g. 'jazz', 'oysters', 'yoga')"),
  category: z
    .enum(CATEGORIES)
    .optional()
    .describe("Filter by offer category"),
  neighborhood: z
    .string()
    .max(60)
    .optional()
    .describe(
      `Filter by neighborhood or city, case-insensitive (e.g. ${NEIGHBORHOODS.slice(0, 4).join(", ")}); external-feed offers may carry other names`,
    ),
  party_size: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Size of the party; filters out offers that can't seat this many people together"),
  max_price: z
    .number()
    .min(0)
    .optional()
    .describe("Maximum promotional price per person, in dollars"),
  within_hours: z
    .number()
    .min(0)
    .max(24 * 14)
    .optional()
    .describe("Only offers starting within this many hours from now (e.g. 6 for 'tonight')"),
  starts_after: z
    .string()
    .datetime()
    .optional()
    .describe("Only offers starting at or after this ISO 8601 timestamp"),
  starts_before: z
    .string()
    .datetime()
    .optional()
    .describe("Only offers starting at or before this ISO 8601 timestamp"),
  min_discount_pct: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Only offers discounted at least this many percent off face value (excludes listings)"),
  claimable_only: z
    .boolean()
    .default(false)
    .describe("Only claimable offers; excludes informational listings synced from external sources"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .default(DEFAULT_SEARCH_LIMIT)
    .describe(`Maximum results to return (default ${DEFAULT_SEARCH_LIMIT})`),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination"),
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
};

const InputSchema = z.object(inputShape);
type Input = z.infer<typeof InputSchema>;

export function registerSearchOffers(
  server: McpServer,
  store: OfferStore,
  analytics: Analytics,
): void {
  server.registerTool(
    "lastcall_search_offers",
    {
      title: "Search LastCall Offers",
      description: `Search live events in ${CITY}: promotional offers on expiring inventory (tonight's empty seats, unsold tickets, open class slots) from connected merchants, plus informational listings synced from external sources (Ticketmaster, and growing).

Two kinds of results, distinguished by "kind"/"claimable":
  - "offer": claimable through LastCall (hold -> confirm -> door code); has discount, availability, and a claim_deadline after which it disappears.
  - "listing": informational only — free events and non-merchant events included for completeness; links out to its source for tickets. lastcall_claim_offer rejects listings.

Results are ranked by discount depth and urgency (listings by urgency; free listings get a small boost). Some merchants pay for priority placement; those results always carry "sponsored": true (JSON) or a [SPONSORED] label (markdown) — ranking boost is bounded and disclosed, never hidden.

Tip: max_price=0 returns free events only. This tool is read-only; claiming happens via lastcall_claim_offer.

Args:
  - query (string, optional): Free-text search, e.g. 'jazz', 'oysters', 'comedy tonight'
  - category (enum, optional): One of ${CATEGORIES.join(", ")}
  - neighborhood (string, optional): Case-insensitive; curated set is ${NEIGHBORHOODS.join(", ")}, and offers synced from external feeds (e.g. Eventbrite) may carry other neighborhood/city names
  - party_size (int, optional): Filters to offers that can seat the whole party
  - max_price (number, optional): Max price per person, in dollars; 0 = free events only (excludes unknown-priced listings)
  - within_hours (number, optional): Only offers starting within N hours (6 ≈ "tonight")
  - starts_after / starts_before (ISO 8601, optional): Explicit time window
  - min_discount_pct (int, optional): Minimum percent off face value (offers only)
  - claimable_only (boolean, default false): Exclude informational listings
  - limit / offset: Pagination (default limit ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT})
  - response_format: 'markdown' (default) or 'json'

Returns (JSON format):
  {
    "total": number,          // matches across all pages
    "count": number,          // results in this response
    "offset": number,
    "has_more": boolean,
    "next_offset": number,    // present when has_more is true
    "offers": [{
      "id": string,                   // pass to lastcall_get_offer / lastcall_claim_offer
      "kind": "offer" | "listing",
      "claimable": boolean,
      "source": string,               // "seed", "eventbrite", "ticketmaster", ...
      "source_url": string,           // present on listings — where tickets are sold
      "corroborated_by": string[],    // present when multiple sources reported this event
      "title": string,
      "merchant": string,
      "merchant_id": string,
      "category": string,
      "neighborhood": string,
      "starts_at": string,            // ISO 8601
      "ends_at": string,
      "price_per_person": string,     // e.g. "$21.00", "Free", or "see source"
      "sponsored": boolean,
      // offers only:
      "claim_deadline": string,       // claim before this or it's gone
      "face_value_per_person": string,
      "discount_pct": number,
      "remaining_spots": number,
      "party_size_min": number,
      "party_size_max": number,
      "new_customers_only": boolean
    }]
  }

Examples:
  - "What can we do tonight for under $30?" -> within_hours=6, max_price=30
  - "Date-night jazz this weekend for 2" -> query="jazz", party_size=2
  - "Cheap workout tomorrow" -> category="fitness", within_hours=36

Error handling:
  - Empty results return a message suggesting broader filters (not an error).`,
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: Input) => {
      try {
        const now = new Date();
        const { offers, total } = store.searchOffers(
          {
            query: params.query,
            category: params.category,
            neighborhood: params.neighborhood,
            claimableOnly: params.claimable_only,
            partySize: params.party_size,
            maxPrice: params.max_price,
            withinHours: params.within_hours,
            startsAfter: params.starts_after ? new Date(params.starts_after) : undefined,
            startsBefore: params.starts_before ? new Date(params.starts_before) : undefined,
            minDiscountPct: params.min_discount_pct,
            limit: params.limit,
            offset: params.offset,
          },
          now,
        );

        // Structured demand exhaust: filters and result stats only, no user
        // identity — aggregate demand is the product, individuals are not.
        analytics.logSearch({
          searchedAt: now,
          query: params.query,
          category: params.category,
          neighborhood: params.neighborhood,
          partySize: params.party_size,
          maxPrice: params.max_price,
          withinHours: params.within_hours,
          minDiscountPct: params.min_discount_pct,
          claimableOnly: params.claimable_only,
          resultTotal: total,
          topResultIds: offers.slice(0, 5).map((o) => o.id),
        });

        if (offers.length === 0) {
          return toolResult(
            "No offers match those filters right now. Try widening the time window (within_hours), dropping the category filter, or raising max_price — inventory changes throughout the day.",
            { total: 0, count: 0, offset: params.offset, has_more: false, offers: [] },
          );
        }

        const hasMore = total > params.offset + offers.length;
        const structured = {
          total,
          count: offers.length,
          offset: params.offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: params.offset + offers.length } : {}),
          offers: offers.map((o) => offerToJson(o, store.getMerchant(o.merchantId))),
        };

        let text: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          const lines = [
            `# LastCall offers in ${CITY}`,
            "",
            `Found ${total} result(s), showing ${offers.length}. Offers are claimable with \`lastcall_claim_offer\`; [LISTING] entries link out to their source for tickets.`,
            "",
            ...offers.map((o) => offerToMarkdown(o, store.getMerchant(o.merchantId), now)),
          ];
          if (hasMore) lines.push("", `More available: pass offset=${params.offset + offers.length}.`);
          text = lines.join("\n");
        } else {
          text = JSON.stringify(structured, null, 2);
        }

        if (text.length > CHARACTER_LIMIT) {
          text = `${text.slice(0, CHARACTER_LIMIT)}\n\n[Truncated. Use a smaller 'limit' or narrower filters.]`;
        }

        return toolResult(text, structured);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

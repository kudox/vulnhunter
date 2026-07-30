import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat, dollars, offerToJson, offerToMarkdown, toolError, toolResult } from "../format.js";
import type { OfferStore } from "../store/store.js";

const inputShape = {
  offer_id: z
    .string()
    .min(1)
    .describe("Offer ID from events_search_offers (e.g. 'off_velvet_late_set')"),
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
};

const InputSchema = z.object(inputShape);
type Input = z.infer<typeof InputSchema>;

export function registerGetOffer(server: McpServer, store: OfferStore): void {
  server.registerTool(
    "events_get_offer",
    {
      title: "Get the events server Offer Details",
      description: `Fetch full details for a single offer: complete description, merchant info and address, terms and restrictions, live availability, and claim instructions.

Use after events_search_offers when the user wants specifics before committing, or to re-check availability of a known offer.

Args:
  - offer_id (string): Offer ID from search results
  - response_format: 'markdown' (default) or 'json'

Returns (JSON format): The same offer object as search results, plus:
  {
    "description": string,
    "terms": string,
    "merchant_address": string,
    "merchant_description": string
  }

Error handling:
  - "Error: No offer found..." if the ID is unknown — re-run events_search_offers; offers vanish permanently after their claim deadline.`,
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
        const offer = store.getOffer(params.offer_id);
        if (!offer) {
          return toolError(
            `No offer found with id '${params.offer_id}'. Offers disappear after their claim deadline — use events_search_offers to see what's live now.`,
          );
        }

        const now = new Date();
        const merchant = store.getMerchant(offer.merchantId);
        const structured = {
          ...offerToJson(offer, merchant),
          description: offer.description,
          terms: offer.terms,
          merchant_address: merchant?.address ?? "",
          merchant_description: merchant?.description ?? "",
        };

        let text: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          const footer =
            offer.kind === "offer"
              ? `Total for a party of N: N × ${dollars(offer.priceCents)}. Claim with \`events_claim_offer\` (holds spots for 10 minutes), then \`events_confirm_redemption\`.`
              : `Informational listing — not claimable through this server. Tickets/details at the source${offer.sourceUrl ? `: ${offer.sourceUrl}` : "."}`;
          text = [
            offerToMarkdown(offer, merchant, now),
            "",
            offer.description,
            "",
            `**Address**: ${merchant?.address ?? "unknown"}, ${offer.neighborhood}`,
            `**About the venue**: ${merchant?.description ?? ""}`,
            `**Terms**: ${offer.terms}`,
            "",
            footer,
          ].join("\n");
        } else {
          text = JSON.stringify(structured, null, 2);
        }

        return toolResult(text, structured);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

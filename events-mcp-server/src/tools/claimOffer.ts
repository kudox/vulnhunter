import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HOLD_DURATION_MINUTES } from "../constants.js";
import { claimToJson, dollars, toolError, toolResult } from "../format.js";
import type { Analytics } from "../services/analytics.js";
import type { ClaimCoordinator } from "../services/claims.js";
import type { OfferStore } from "../store/store.js";

const inputShape = {
  offer_id: z
    .string()
    .min(1)
    .describe("Offer ID from events_search_offers (e.g. 'off_fogline_tonight')"),
  party_size: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe("Number of people; must fall within the offer's party_size_min/max"),
};

const InputSchema = z.object(inputShape);
type Input = z.infer<typeof InputSchema>;

export function registerClaimOffer(
  server: McpServer,
  store: OfferStore,
  coordinator: ClaimCoordinator,
  analytics: Analytics,
): void {
  server.registerTool(
    "events_claim_offer",
    {
      title: "Claim a the events server Offer",
      description: `Place a ${HOLD_DURATION_MINUTES}-minute hold on an offer for a party. Spots are deducted from availability immediately; the hold auto-expires and the spots return to the pool if not confirmed in time.

Flow: claim -> present price and terms to the user -> events_confirm_redemption to lock it in (or events_release_claim to give the spots back early).

IMPORTANT: Confirm with the user before claiming — a claim takes real inventory off the market, even if only for ${HOLD_DURATION_MINUTES} minutes.

Args:
  - offer_id (string): Offer to claim
  - party_size (int): Number of people (within the offer's allowed range)

Returns:
  {
    "claim_id": string,          // e.g. "clm_a1b2c3d4e5"
    "offer_id": string,
    "offer_title": string,
    "status": "held",
    "party_size": number,
    "redemption_code": string,   // e.g. "EV-4F7A2B" — shown at the door after confirmation
    "hold_expires_at": string,   // ISO 8601 — confirm before this
    "total": string,             // e.g. "$42.00" for the whole party
    "platform_fee": string,      // 12% platform take, charged to the merchant at confirmation
    "merchant_net": string
  }

Error handling:
  - "sold out": remaining spots < party_size — search for alternatives
  - "expired": claim deadline passed — search for alternatives
  - "party size": outside the offer's min/max — adjust party_size`,
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: Input) => {
      try {
        const result = await coordinator.claim(params.offer_id, params.party_size);
        if (!result.ok) {
          return toolError(result.message);
        }

        const claim = result.value;
        const offer = store.getOffer(claim.offerId);
        if (offer) analytics.recordEventSnapshots([offer]); // remaining changed
        const structured = claimToJson(claim, offer);

        const text = [
          `Hold placed on **${offer?.title ?? claim.offerId}** for ${claim.partySize}.`,
          "",
          `- **Total**: ${dollars(claim.totalCents)} (${claim.partySize} × ${dollars(offer?.priceCents ?? 0)})`,
          `- **Claim ID**: \`${claim.id}\``,
          `- **Redemption code**: \`${claim.redemptionCode}\` (valid after confirmation)`,
          `- **Hold expires**: ${claim.holdExpiresAt.toISOString()} (${HOLD_DURATION_MINUTES} minutes)`,
          "",
          `Confirm with \`events_confirm_redemption\` before the hold expires, or release with \`events_release_claim\`.`,
        ].join("\n");

        return toolResult(text, structured);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

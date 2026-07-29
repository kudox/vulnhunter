import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PLATFORM_FEE_PCT } from "../constants.js";
import { claimToJson, dollars, toolError, toolResult } from "../format.js";
import type { ClaimCoordinator } from "../services/claims.js";
import type { OfferStore } from "../store/store.js";

const inputShape = {
  claim: z
    .string()
    .min(1)
    .describe("Claim ID (e.g. 'clm_a1b2c3d4e5') or redemption code (e.g. 'LC-4F7A2B') from lastcall_claim_offer"),
};

const InputSchema = z.object(inputShape);
type Input = z.infer<typeof InputSchema>;

export function registerConfirmRedemption(
  server: McpServer,
  store: OfferStore,
  coordinator: ClaimCoordinator,
): void {
  server.registerTool(
    "lastcall_confirm_redemption",
    {
      title: "Confirm a LastCall Redemption",
      description: `Convert an active hold into a confirmed booking. This is the money moment: the redemption code becomes valid at the door and the merchant is charged the platform fee (${PLATFORM_FEE_PCT}% of transaction value). In production this step runs payment (agentic checkout); the scaffold simulates it and returns the receipt.

Idempotent: confirming an already-confirmed claim returns the same receipt.

IMPORTANT: Get explicit user approval before confirming — this finalizes the purchase.

Args:
  - claim (string): Claim ID or redemption code

Returns:
  {
    "claim_id": string,
    "offer_id": string,
    "offer_title": string,
    "status": "confirmed",
    "party_size": number,
    "redemption_code": string,   // show this at the door
    "confirmed_at": string,      // ISO 8601
    "total": string,
    "platform_fee": string,      // LastCall's ${PLATFORM_FEE_PCT}% take
    "merchant_net": string       // what the merchant receives
  }

Error handling:
  - Hold expired or released: seats went back to the pool — claim the offer again if it's still available
  - Unknown claim: check the claim_id/redemption code from lastcall_claim_offer`,
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: Input) => {
      try {
        const result = await coordinator.confirm(params.claim);
        if (!result.ok) {
          return toolError(result.message);
        }

        const claim = result.value;
        const offer = store.getOffer(claim.offerId);
        const structured = claimToJson(claim, offer);

        const text = [
          `Confirmed: **${offer?.title ?? claim.offerId}** for ${claim.partySize}.`,
          "",
          `- **Redemption code**: \`${claim.redemptionCode}\` — show this at the door`,
          `- **Total**: ${dollars(claim.totalCents)}`,
          `- **Merchant receives**: ${structured.merchant_net} (platform fee ${structured.platform_fee})`,
          "",
          `Terms: ${offer?.terms ?? "see offer details"}`,
        ].join("\n");

        return toolResult(text, structured);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

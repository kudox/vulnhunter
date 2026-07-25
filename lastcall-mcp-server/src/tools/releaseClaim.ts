import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { claimToJson, toolError, toolResult } from "../format.js";
import type { OfferStore } from "../store/store.js";

const inputShape = {
  claim: z
    .string()
    .min(1)
    .describe("Claim ID (e.g. 'clm_a1b2c3d4e5') or redemption code (e.g. 'LC-4F7A2B') of an active hold"),
};

const InputSchema = z.object(inputShape);
type Input = z.infer<typeof InputSchema>;

export function registerReleaseClaim(server: McpServer, store: OfferStore): void {
  server.registerTool(
    "lastcall_release_claim",
    {
      title: "Release a LastCall Hold",
      description: `Release an active hold early, returning its spots to the pool so other parties can claim them. Use when the user changes their mind before confirming. Confirmed bookings cannot be released (no refunds in the scaffold; cancellation policy is a roadmap item).

Args:
  - claim (string): Claim ID or redemption code of a hold with status "held"

Returns:
  { "claim_id": string, "offer_id": string, "status": "released", ... }

Error handling:
  - "invalid state" if the claim is already confirmed, released, or expired.`,
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
        const result = store.releaseClaim(params.claim);
        if (!result.ok) {
          return toolError(result.message);
        }

        const claim = result.value;
        const offer = store.getOffer(claim.offerId);
        return toolResult(
          `Released hold \`${claim.id}\` on **${offer?.title ?? claim.offerId}** — ${claim.partySize} spot(s) returned to the pool.`,
          claimToJson(claim, offer),
        );
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

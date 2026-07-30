import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { claimToJson, toolError, toolResult } from "../format.js";
import type { Analytics } from "../services/analytics.js";
import type { ClaimCoordinator } from "../services/claims.js";
import type { OfferStore } from "../store/store.js";

const inputShape = {
  claim: z
    .string()
    .min(1)
    .describe("Claim ID (e.g. 'clm_a1b2c3d4e5') or redemption code (e.g. 'EV-4F7A2B') of an active hold"),
};

const InputSchema = z.object(inputShape);
type Input = z.infer<typeof InputSchema>;

export function registerReleaseClaim(
  server: McpServer,
  store: OfferStore,
  coordinator: ClaimCoordinator,
  analytics: Analytics,
): void {
  server.registerTool(
    "events_release_claim",
    {
      title: "Release a the events server Hold",
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
        const result = await coordinator.release(params.claim);
        if (!result.ok) {
          return toolError(result.message);
        }

        const claim = result.value;
        const offer = store.getOffer(claim.offerId);
        if (offer) analytics.recordEventSnapshots([offer]); // remaining restored
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

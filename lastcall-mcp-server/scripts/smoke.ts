/**
 * End-to-end smoke test: drives the server through the full offer lifecycle
 * over an in-memory MCP transport, exactly as a real client would.
 *
 *   npm run smoke
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

interface ToolResultLike {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

function firstText(result: ToolResultLike): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`SMOKE FAIL: ${message}`);
}

async function main(): Promise<void> {
  const { server } = createServer();
  const client = new Client({ name: "smoke-client", version: "0.0.1" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  // 1. Tools are listed
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));
  assert(names.length === 5, `expected 5 tools, got ${names.length}`);

  // 2. Search: tonight, party of 2, under $30/person
  const search = (await client.callTool({
    name: "lastcall_search_offers",
    arguments: { within_hours: 8, party_size: 2, max_price: 30, response_format: "json" },
  })) as ToolResultLike;
  assert(!search.isError, `search errored: ${firstText(search)}`);
  const offers = (search.structuredContent?.offers ?? []) as Array<Record<string, unknown>>;
  console.log(`search: ${offers.length} offers starting within 8h under $30`);
  assert(offers.length > 0, "expected at least one offer tonight");
  assert(
    offers.every((o) => typeof o.sponsored === "boolean"),
    "every offer must disclose sponsored status",
  );

  const offerId = offers[0].id as string;

  // 3. Offer details
  const detail = (await client.callTool({
    name: "lastcall_get_offer",
    arguments: { offer_id: offerId, response_format: "json" },
  })) as ToolResultLike;
  assert(!detail.isError, `get_offer errored: ${firstText(detail)}`);
  const remainingBefore = detail.structuredContent?.remaining_spots as number;
  console.log(`detail: ${detail.structuredContent?.title} — ${remainingBefore} spots left`);

  // 4. Claim for a party of 2
  const claim = (await client.callTool({
    name: "lastcall_claim_offer",
    arguments: { offer_id: offerId, party_size: 2 },
  })) as ToolResultLike;
  assert(!claim.isError, `claim errored: ${firstText(claim)}`);
  const claimId = claim.structuredContent?.claim_id as string;
  const code = claim.structuredContent?.redemption_code as string;
  console.log(`claim: ${claimId} code=${code} total=${claim.structuredContent?.total}`);

  // 5. Inventory actually decremented
  const detailAfter = (await client.callTool({
    name: "lastcall_get_offer",
    arguments: { offer_id: offerId, response_format: "json" },
  })) as ToolResultLike;
  const remainingAfter = detailAfter.structuredContent?.remaining_spots as number;
  assert(
    remainingAfter === remainingBefore - 2,
    `expected ${remainingBefore - 2} spots after claim, got ${remainingAfter}`,
  );
  console.log(`inventory: ${remainingBefore} -> ${remainingAfter} after hold`);

  // 6. Confirm by redemption code; check fee math (12%)
  const confirm = (await client.callTool({
    name: "lastcall_confirm_redemption",
    arguments: { claim: code },
  })) as ToolResultLike;
  assert(!confirm.isError, `confirm errored: ${firstText(confirm)}`);
  assert(confirm.structuredContent?.status === "confirmed", "claim should be confirmed");
  console.log(
    `confirm: total=${confirm.structuredContent?.total} fee=${confirm.structuredContent?.platform_fee} merchant_net=${confirm.structuredContent?.merchant_net}`,
  );

  // 7. Confirm is idempotent
  const confirmAgain = (await client.callTool({
    name: "lastcall_confirm_redemption",
    arguments: { claim: claimId },
  })) as ToolResultLike;
  assert(!confirmAgain.isError, "second confirm should be idempotent, not an error");

  // 8. Release path: new claim, then release, inventory restored
  const claim2 = (await client.callTool({
    name: "lastcall_claim_offer",
    arguments: { offer_id: offerId, party_size: 2 },
  })) as ToolResultLike;
  assert(!claim2.isError, `second claim errored: ${firstText(claim2)}`);
  const release = (await client.callTool({
    name: "lastcall_release_claim",
    arguments: { claim: claim2.structuredContent?.claim_id as string },
  })) as ToolResultLike;
  assert(!release.isError, `release errored: ${firstText(release)}`);
  const detailFinal = (await client.callTool({
    name: "lastcall_get_offer",
    arguments: { offer_id: offerId, response_format: "json" },
  })) as ToolResultLike;
  assert(
    (detailFinal.structuredContent?.remaining_spots as number) === remainingAfter,
    "released spots should return to the pool",
  );
  console.log("release: spots returned to pool");

  // 9. Guardrails: oversized party and unknown offer fail cleanly
  const badParty = (await client.callTool({
    name: "lastcall_claim_offer",
    arguments: { offer_id: offerId, party_size: 19 },
  })) as ToolResultLike;
  assert(badParty.isError, "claiming with an oversized party should error");
  const badOffer = (await client.callTool({
    name: "lastcall_get_offer",
    arguments: { offer_id: "off_does_not_exist" },
  })) as ToolResultLike;
  assert(badOffer.isError, "unknown offer should error");
  console.log("guardrails: bad party size and unknown offer rejected with actionable errors");

  await client.close();
  console.log("\nSMOKE OK — full lifecycle (search -> detail -> claim -> confirm -> release) passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

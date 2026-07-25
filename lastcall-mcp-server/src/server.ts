import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import type { OfferStore } from "./store/store.js";
import { InMemoryOfferStore } from "./store/store.js";
import { registerClaimOffer } from "./tools/claimOffer.js";
import { registerConfirmRedemption } from "./tools/confirmRedemption.js";
import { registerGetOffer } from "./tools/getOffer.js";
import { registerReleaseClaim } from "./tools/releaseClaim.js";
import { registerSearchOffers } from "./tools/searchOffers.js";

export interface CreateServerOptions {
  /** Inject a store (e.g. a fixed-clock store in tests); defaults to the seeded in-memory store. */
  store?: OfferStore;
}

export function createServer(options: CreateServerOptions = {}): {
  server: McpServer;
  store: OfferStore;
} {
  const store = options.store ?? new InMemoryOfferStore();

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerSearchOffers(server, store);
  registerGetOffer(server, store);
  registerClaimOffer(server, store);
  registerConfirmRedemption(server, store);
  registerReleaseClaim(server, store);

  return { server, store };
}

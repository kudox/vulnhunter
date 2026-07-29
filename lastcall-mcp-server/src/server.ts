import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import type { Analytics } from "./services/analytics.js";
import { NOOP_ANALYTICS } from "./services/analytics.js";
import { ClaimCoordinator } from "./services/claims.js";
import type { LastcallDb } from "./services/db.js";
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
  /** Analytics/durability sink; defaults to a no-op (no database required). */
  analytics?: Analytics;
  /** Shared database; when present, claims are reserved atomically in Postgres (multi-instance safe). */
  db?: LastcallDb;
}

export function createServer(options: CreateServerOptions = {}): {
  server: McpServer;
  store: OfferStore;
} {
  const store = options.store ?? new InMemoryOfferStore();
  const analytics = options.analytics ?? NOOP_ANALYTICS;
  const coordinator = new ClaimCoordinator(store, options.db);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerSearchOffers(server, store, analytics);
  registerGetOffer(server, store);
  registerClaimOffer(server, store, coordinator, analytics);
  registerConfirmRedemption(server, store, coordinator);
  registerReleaseClaim(server, store, coordinator, analytics);

  return { server, store };
}

# LastCall MCP Server

**A perishable-inventory promotion marketplace, built as an MCP server.**

Local merchants have inventory that expires worthless every day: tonight's empty jazz-club seats, the 5pm restaurant lull, tomorrow's half-full yoga class, this weekend's unsold theater tickets. LastCall lets merchants post that inventory as targeted, rules-bound promotions — and lets AI agents search, claim, and redeem those offers on behalf of users.

The business model: **merchants pay only on redemption** (a 12% platform fee at confirmation), never for impressions. Sponsored placement exists but is bounded and always disclosed in results (`"sponsored": true`).

This is a working scaffold: the full offer lifecycle runs end-to-end against an in-memory store seeded with fictional San Francisco merchants. Seed offer times are generated relative to server start, so a fresh server always has inventory "tonight" and "this weekend." With an Eventbrite API token, the server also syncs **real live events** from connected Eventbrite organizations into the same offer pool (see below).

## Tools

| Tool | What it does |
|---|---|
| `lastcall_search_offers` | Search live offers with filters (category, neighborhood, party size, price, time window, min discount). Ranked by discount depth + urgency; sponsored results labeled. |
| `lastcall_get_offer` | Full details for one offer: description, venue, terms, live availability. |
| `lastcall_claim_offer` | Place a 10-minute hold; spots come off the market immediately and auto-return if not confirmed. |
| `lastcall_confirm_redemption` | Convert a hold into a confirmed booking; returns the door code and the fee-split receipt. Idempotent. |
| `lastcall_release_claim` | Release a hold early; spots return to the pool. |

## Quickstart

```bash
npm install
npm run build

# End-to-end smoke test (search -> claim -> confirm -> release over MCP)
npm run smoke
```

### Connect to Claude Code

```bash
claude mcp add lastcall -- node /absolute/path/to/lastcall-mcp-server/dist/index.js
```

### Connect to Claude Desktop

```json
{
  "mcpServers": {
    "lastcall": {
      "command": "node",
      "args": ["/absolute/path/to/lastcall-mcp-server/dist/index.js"]
    }
  }
}
```

Then try: *"What can two of us do tonight in SF for under $30 each?"*

### Run as HTTP server

```bash
TRANSPORT=http PORT=3000 npm start   # serves streamable HTTP on /mcp
```

### Inspect interactively

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Eventbrite integration

With a token, the server ingests live events from your Eventbrite organization(s) and turns the under-sold ones into LastCall offers alongside (or instead of) the seed data:

```bash
EVENTBRITE_API_TOKEN=your_private_token npm start        # seed + real events
EVENTBRITE_API_TOKEN=... LASTCALL_SEED=off npm start     # real events only
```

Get a private token at eventbrite.com → Account Settings → Developer Links → API Keys. Verify the wiring without a token via the fixture suite: `npm run test:eventbrite`.

**How it works.** Eventbrite retired its public event-search API in 2020, so ingestion is organization-scoped: the token's orgs are enumerated (`/users/me/organizations/`), their live events pulled with `expand=venue,ticket_availability`, and per-event ticket classes fetched for real `quantity_total`/`quantity_sold` numbers. That constraint matches the supply model anyway — offers come from merchants who connected their account, not from scraping. Each sync then applies the **promotion rule** to decide what becomes an offer:

| Rule | Default | Env override |
|---|---|---|
| Discount off face value | 25% | `LASTCALL_EB_DISCOUNT_PCT` |
| Claim cutoff before start | 2h | `LASTCALL_EB_CLAIM_CUTOFF_HOURS` |
| Only promote events under this sold ratio | 80% | `LASTCALL_EB_MAX_SOLD_RATIO` |
| Max spots released per promotion | 40 | `LASTCALL_EB_MAX_SPOTS` |
| Ignore events further out than | 14 days | `LASTCALL_EB_MAX_DAYS_OUT` |

Sold-out, free/unpriced, well-selling, and far-future events are skipped (each skip is logged with its reason). Face value is the cheapest paid ticket tier; if ticket classes aren't readable on the token, pricing falls back to the `ticket_availability` expansion. Venues become merchants; SF postal codes map to neighborhoods. Re-sync runs every 30 minutes (`EVENTBRITE_REFRESH_MINUTES`, `0` to disable) and preserves spots consumed by active local holds. `EVENTBRITE_ORG_IDS` (comma-separated) restricts which orgs sync.

**Scaffold limitation:** claims and confirmations are local to LastCall — they don't write holds back to Eventbrite, so a spot confirmed here could in principle sell on Eventbrite too. The production fix is writing holds/orders through the Eventbrite API (or taking over ticketing for the promoted allotment) — same attribution argument as owning checkout.

## Architecture

```
src/
├── index.ts            # entry point; stdio (default) or streamable HTTP transport
├── server.ts           # McpServer wiring; registers all tools against a store
├── constants.ts        # fee %, hold duration, neighborhoods, categories
├── types.ts            # domain model: Merchant, Offer, Claim
├── format.ts           # shared markdown/JSON rendering + result helpers
├── store/
│   ├── store.ts        # OfferStore interface + in-memory implementation
│   └── seed.ts         # demo SF merchants/offers, times relative to now
├── services/
│   ├── eventbrite.ts            # Eventbrite v3 API client (injectable fetch)
│   └── eventbriteInventory.ts   # promotion rules + event -> offer mapping (pure)
└── tools/              # one file per tool
```

Design decisions worth knowing:

- **`OfferStore` is an interface.** The in-memory implementation is for demos; production swaps in Postgres behind the same contract, adding real transactional guarantees around holds.
- **Holds expire lazily.** Every public store operation sweeps lapsed holds back into the pool first — no background timers, availability is always current.
- **Sponsored ranking is honest.** Sponsorship adds a bounded score boost and is always disclosed in both output formats. Placement is sellable; hiding it is not.
- **The fee split is visible in receipts** (`platform_fee`, `merchant_net`) so the business model stays legible end-to-end, even in the scaffold.
- **Claims are guarded.** Party-size limits, claim deadlines, and quantity caps are merchant guardrails enforced by the store — the anti-Groupon design: capped, targeted, expiring offers only.

## Production roadmap

Deliberately out of scope for the scaffold, in rough build order:

1. **Postgres store** — same `OfferStore` contract, row-level locking on claims.
2. **Payments in the confirm step** — agentic checkout (e.g. Stripe's Machine Payments Protocol) so attribution is airtight and the platform fee is clipped at the source.
3. **More inventory feeds** — Eventbrite is wired (see above); next: Ticketmaster (events), Square/Toast (restaurants), Mindbody (fitness/wellness), plus write-back of holds to the source system.
4. **Per-merchant rules engine** — the global promotion rule becomes per-merchant config: "any show under 60% sold within 48h of start → 25% off, max 40 tickets, never Saturdays."
5. **Merchant-facing MCP server** — merchants post and tune promos through their own AI assistant.
6. **Auth + rate limiting** — OAuth for the HTTP transport; per-client quotas.
7. **Cancellation/refund policy** — releasing confirmed bookings, merchant-configurable.
8. **Demand intelligence** — aggregate query/claim analytics sold back to merchants ("340 searches for live music for 4+ on Thursdays; you had zero Thursday inventory posted").

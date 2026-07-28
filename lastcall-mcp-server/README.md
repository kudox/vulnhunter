# LastCall MCP Server

**A perishable-inventory promotion marketplace, built as an MCP server.**

Local merchants have inventory that expires worthless every day: tonight's empty jazz-club seats, the 5pm restaurant lull, tomorrow's half-full yoga class, this weekend's unsold theater tickets. LastCall lets merchants post that inventory as targeted, rules-bound promotions — and lets AI agents search, claim, and redeem those offers on behalf of users.

The business model: **merchants pay only on redemption** (a 12% platform fee at confirmation), never for impressions. Sponsored placement exists but is bounded and always disclosed in results (`"sponsored": true`).

This is a working scaffold: the full offer lifecycle runs end-to-end against an in-memory store seeded with fictional San Francisco merchants. Seed offer times are generated relative to server start, so a fresh server always has inventory "tonight" and "this weekend." With an Eventbrite API token, the server also syncs **real live events** from connected Eventbrite organizations into the same offer pool (see below).

**Project tracking**: [TASKS.md](./TASKS.md) (backlog/WIP/done) · [WORKLOG.md](./WORKLOG.md) (per-session decisions and gotchas) · [docs/OSINT-EVENT-SOURCING.md](./docs/OSINT-EVENT-SOURCING.md) (free/non-merchant event ingestion plan).

## Tools

| Tool | What it does |
|---|---|
| `lastcall_search_offers` | Search live events with filters (category, neighborhood, party size, price, time window, min discount, `claimable_only`). Returns claimable **offers** and informational **listings** (see below); ranked by discount depth + urgency; sponsored results labeled. `max_price=0` = free events only. |
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

## Two-tier inventory: offers vs listings

Search results carry a `kind`:

- **`offer`** — claimable through LastCall (hold → confirm → door code), from connected merchants. The monetized tier.
- **`listing`** — informational events synced from OSINT sources (free events and non-merchant events included), always attributed with a `source_url` link-out. Not claimable — `lastcall_claim_offer` rejects listings and points the agent at the source. The completeness tier that makes the tool the default answer to "what's happening tonight?" (strategy: [docs/OSINT-EVENT-SOURCING.md](./docs/OSINT-EVENT-SOURCING.md)).

Cross-source duplicates are merged by the dedup engine (`src/services/dedup.ts`): fuzzy match on title + venue + start-time ±45min, winner picked by source precedence (ticketing APIs > venue sites > aggregators > LLM-extracted), all corroborating sources kept in `corroborated_by`. A listing never displaces an existing claimable offer for the same event.

## Ticketmaster listings (OSINT source #1)

```bash
TICKETMASTER_API_KEY=your_key npm start   # free key at developer.ticketmaster.com
```

The Discovery API has genuinely public search (free tier: 5,000 calls/day). The adapter pulls upcoming events for `TICKETMASTER_CITY`/`TICKETMASTER_STATE_CODE` (default San Francisco/CA) within `LASTCALL_LISTING_MAX_DAYS_OUT` (14 days), maps segments to categories (Music → live_music, Comedy genre → comedy, Sports → sports, …), and ingests them as listings. Events with no concrete start time or a non-onsale status are skipped with logged reasons; missing price ranges become `priceUnknown` (excluded from any `max_price` search). Re-ingest runs every 60 min (`LASTCALL_INGEST_REFRESH_MINUTES`, `0` to disable). Verify without a key: `npm run test:listings`.

New adapters implement `SourceAdapter` (`src/services/adapters/types.ts`) and get dedup, provenance, and refresh for free via the shared ingest pipeline (`src/services/ingest.ts`).

## Venue-website crawler (OSINT source #2)

```bash
LASTCALL_JSONLD=on npm start                          # crawl the curated SF venue list
LASTCALL_JSONLD=on LASTCALL_JSONLD_VENUES=https://... # or your own comma-separated URLs
```

Extracts schema.org `Event` JSON-LD from venue event pages (`src/services/adapters/sfVenues.ts` holds the curated list — adding a venue is adding a URL). Politeness is built in: robots.txt honored per host, identifiable `LastCallBot` User-Agent, sequential fetches, per-venue error isolation. Timezone-naive datetimes (a Live Nation quirk) are interpreted as venue-local. Opt-in via `LASTCALL_JSONLD=on` since it makes outbound requests to third-party sites. Verify offline: `npm run test:jsonld`.

Live-yield reality (2026-07-28 crawl): calendar-page JSON-LD is common on Live Nation venue sites but rare elsewhere — many venues render events client-side or only embed JSON-LD on per-event detail pages, and some sites bot-wall automated fetches. The crawler's near-term value is corroboration + gap-filling next to the Ticketmaster feed; a follow-event-links mode (fetching detail pages) is the planned yield upgrade.

## ICS calendar feeds (OSINT source #3 — the free-event layer)

```bash
LASTCALL_ICS=on npm start                                    # curated SF community feeds
LASTCALL_ICS=on LASTCALL_ICS_FEEDS=webcal://...,https://...  # your own feeds
```

Ingests published iCalendar feeds — Google Calendar public ICS, Meetup group iCals (`meetup.com/<group>/events/ical/`, still public post-API-lockdown), library/city calendars. These are explicitly machine-readable, extremely stable, and skew toward free community events no ticketing API carries. The dependency-free parser (`src/services/ics.ts`) handles line unfolding, TZID/UTC/floating datetimes, text escaping, DURATION, and **recurring events** (DAILY/WEEKLY RRULE expansion with INTERVAL/COUNT/UNTIL/EXDATE — the weekly-workshop pattern that dominates civic calendars; MONTHLY+ rules are skipped with logged reasons rather than mis-expanded). Feeds flagged `assumeFree` yield $0 listings since iCalendar has no price field; others get `priceUnknown`. Curated list in `src/services/adapters/sfIcsFeeds.ts` (all verified live); `webcal://` URLs accepted. Verify offline: `npm run test:ics`.

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
│   ├── eventbriteInventory.ts   # promotion rules + event -> offer mapping (pure)
│   ├── dedup.ts                 # cross-source dedup/merge (precedence + provenance)
│   ├── ingest.ts                # shared listing-ingest pipeline
│   ├── neighborhoods.ts         # SF zip -> neighborhood mapping
│   ├── dates.ts                 # timezone-aware naive-datetime parsing
│   ├── ics.ts                   # dependency-free iCalendar parser + RRULE expansion
│   └── adapters/
│       ├── types.ts             # SourceAdapter contract
│       ├── ticketmaster.ts      # Discovery API adapter (listings)
│       ├── jsonldCrawler.ts     # venue-website schema.org crawler
│       ├── sfVenues.ts          # curated venue seed list
│       ├── icsFeeds.ts          # ICS/iCal feed adapter
│       └── sfIcsFeeds.ts        # curated community-calendar feed list
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

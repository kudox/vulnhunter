# Work Log

Session-by-session record of work done, design decisions, and gotchas worth
remembering. Newest first. Update this at the end of any session that ships
meaningful work.

Conventions: each entry lists what shipped (with commits), the decisions that
will constrain future work, and gotchas — things that cost time or will bite
again if forgotten.

---

## 2026-07-28 — JSON-LD venue crawler (OSINT source #2)

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Shipped**
- `JsonLdCrawlerAdapter`: extracts schema.org `Event` JSON-LD from venue pages. Robots.txt honored per host (minimal `User-agent: *` parser), identifiable `LastCallBot` UA, sequential fetches, per-venue error isolation, @graph/ItemList/subEvent walking, stable IDs (`sha256(host|url|startDate)`), Event-subtype → category mapping, relative URL resolution.
- Curated 23-venue SF seed list (`sfVenues.ts`); opt-in via `LASTCALL_JSONLD=on` (it fetches third-party sites); `LASTCALL_JSONLD_VENUES` override.
- Ingest fix: anchor filter now matches prefixed sources (`jsonld:<host>`), otherwise every re-sync self-deduplicated its own prior batch.
- `npm run test:jsonld` fixture suite.

**Live validation (2026-07-28)**
- Combined TM + crawler run: 142 TM + 9 crawler events, **22 merged, 129 upserted, 8 events corroborated by two sources** (e.g. Steve-O at Cobb's, Old 97's at the Fillmore carrying both `ticketmaster` and `jsonld:` provenance) — the dedup engine's first real-world cross-source merges, and 1 crawler-only event TM's city search missed.
- **Yield reality check**: only 2/23 venues emit JSON-LD on their calendar pages (both Live Nation-run). 5 venues bot-wall us (403: SFJAZZ, The Midway, de Young, Exploratorium, Commonwealth Club); most others are client-rendered SPAs with JSON-LD only on per-event detail pages. Conclusion: crawler as built = corroboration + gap-filler; the yield unlock is a follow-event-links mode (backlogged), and bot-walled venues are better covered via aggregators.

**Design decisions**
- Naive datetimes are interpreted in a configurable venue timezone (default America/Los_Angeles) via an Intl-based offset computation — no timezone library dependency.
- Date-only `startDate` (all-day/TBA) is skipped rather than inventing a time.
- Non-USD prices are treated as unknown rather than mis-parsed.

**Gotchas**
- **Live Nation JSON-LD startDates are timezone-naive** ("2026-07-31T20:00:00"); naive `new Date()` reads them as UTC and an 8pm show becomes 1pm PT. This also silently broke dedup (times off by 7h > ±45min window) — the corroboration count going 0 → 8 after the fix was the tell.
- Live Nation venue pages embed ticketmaster.com URLs in their JSON-LD — crawler output for those venues is mostly redundant with the Discovery API (dedup handles it), but it still catches events the TM city query misses.

---

## 2026-07-25 — OSINT Phase 1: listing tier, dedup engine, Ticketmaster adapter

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Shipped**
- Two-tier inventory model: `Offer.kind` ("offer" | "listing") with `source`/`sourceUrl`/`sources` provenance and `priceUnknown`. Listings are searchable but not claimable — the claim guard points agents at the source URL.
- Dedup/merge engine (`src/services/dedup.ts`), `SourceAdapter` contract + shared ingest pipeline (`src/services/ingest.ts`), Ticketmaster Discovery adapter as the first OSINT source, and `npm run test:listings` covering all of it.
- Search: `claimable_only` filter; `max_price=0` now means "free events only"; listings render with `[LISTING]` label + link-out.

**Design decisions**
- **Dedup matching**: token-overlap similarity (over the smaller set, so "X" matches "X — Late Set") on title AND venue, plus start-time ±45min. No fuzzy-match dependency; thresholds at 0.5. Stopword list strips venue-noise words ("presents", "live", "sf"…).
- **Source precedence**: seed(100) > ticketing APIs (eventbrite/ticketmaster, 90) > venue JSON-LD (70) > ICS (60) > aggregators (50) > newsletter/news LLM-extracted (10). Prefixed sources ("jsonld:sfjazz.org") match on prefix.
- **Anchor rule**: an incoming listing matching anything already in the store is dropped — a listing must never displace a claimable offer. Losing sources are preserved in `sources` (`corroborated_by` in output) as a future ranking signal; enriching anchors with them is a backlog item.
- **Unknown price ≠ free**: Ticketmaster often omits `priceRanges`; those listings get `priceUnknown` and are excluded from any `max_price` search rather than masquerading as $0.
- Ranking: listings score urgency-only (+small free boost) so claimable offers generally lead without burying listings.
- Ingest isolates adapter failures (one broken source doesn't sink the sync) and re-syncs each 60 min (`LASTCALL_INGEST_REFRESH_MINUTES`).

**Live validation (real API key, 2026-07-28)**
- First real sync: **142 SF events ingested, 5 skipped (4 cancelled, 1 rescheduled), 14 merged as duplicates, 128 upserted** alongside the 16 seed offers. Categories: 55 live_music, 31 comedy, 17 theater, 17 art_culture, 8 sports. Real inventory verified: Giants at Oracle Park, touring Broadway at the Orpheum, Punch Line comedy, The Chapel, Brick & Mortar — plus genuinely **free** events (open mics/karaoke at $0) proving the free-tier goal.
- Data-quality finding: only **31/128 listings had priceRanges** — `priceUnknown` is the common case on TM, so most listings are invisible to `max_price` searches. Future enrichment (venue JSON-LD, event-page scrape) should backfill prices.
- Multi-showtime runs (same show, 3 showtimes) correctly survive dedup as distinct events; the 14 merges were true duplicates.
- Many TM events resolve to TicketWeb URLs (TM subsidiary) — link-outs work fine either way.

**Gotchas**
- Ticketmaster Discovery: date params must be ISO **without milliseconds**; deep paging is rejected past item ~1000 (we cap at 5×100/page); `dates.start` can be date-only (TBA time) — skip those; check `dates.status.code` for cancelled/postponed events.
- Node's global fetch ignores `HTTPS_PROXY` by default — in proxied environments (like remote sessions) run with `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca-bundle>`.
- Ingest anchors must exclude the syncing adapter's own prior records, or every re-sync deduplicates itself away.
- Added "sports" to `CATEGORIES` for TM's Sports segment — category enum is ours to extend, but tool descriptions embed it, so they update automatically via the constant.

---

## 2026-07-25 — Tracking system + OSINT event-sourcing plan

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g) · branch `claude/mcp-revenue-brainstorm-9ybtd1`

**Shipped**
- `TASKS.md` (backlog/WIP/done) and this `WORKLOG.md` as the project's durable tracking layer.
- `docs/OSINT-EVENT-SOURCING.md`: researched plan for ingesting free events and non-merchant events (see doc for the tiered source list and phasing).

**Design decisions**
- Tracking lives in repo-committed markdown (not CLAUDE.md, not session task lists) because remote session containers are ephemeral — anything uncommitted is lost.
- Strategic decision recorded in the OSINT plan: inventory becomes two-tier — claimable **offers** (paying merchants, monetized) and free **listings** (OSINT-sourced, link-out only). Listings are the demand-side moat: agents adopt the tool that answers "what's happening tonight" completely, and monetization stays on offers.

**Gotchas**
- Meetup's open API is gone (locked to GraphQL + auth, meaningful access needs Pro, since Feb 2025); their public pages still embed JSON-LD / `__NEXT_DATA__`.
- Ticketmaster Discovery API remains free: 5,000 calls/day, 5 req/s — plenty for a metro sync.

---

## 2026-07-25 — Eventbrite live-inventory integration

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g) · commit `aedaa91`

**Shipped**
- Eventbrite v3 client (`src/services/eventbrite.ts`): Bearer auth, continuation pagination, injectable fetch, actionable 401/429 errors.
- Pure mapper + promotion rule (`src/services/eventbriteInventory.ts`): decides which events become offers (defaults: 25% off, 2h claim cutoff, skip events ≥80% sold, cap 40 spots, 14-day horizon; `LASTCALL_EB_*` env overrides).
- `OfferStore.upsertInventory` re-sync semantics; startup sync + 30-min refresh; `LASTCALL_SEED=off`; fixture test suite (`npm run test:eventbrite`) against a fake fetch.

**Design decisions**
- **Org-scoped ingestion, framed as a feature**: Eventbrite retired public event search in 2020, so you can only read events for organizations the token belongs to. This matches the supply model (merchants connect their account) — but it's also why OSINT sourcing (see 2026-07-25 plan) is required for demand-side completeness.
- Face value = cheapest *paid* ticket tier; free/donation/hidden tiers ignored. Fallback to the `ticket_availability` expansion when ticket classes aren't readable on the token.
- Skip reasons are first-class (`sold out`, `selling well`, `free or unpriced`, `too far out`) and logged per sync — this is the audit trail for "why isn't my event showing?".
- Re-syncs preserve spots consumed by active local holds/confirmations (feed availability doesn't know about our holds).
- `Neighborhood` widened from enum to string; feed venues carry arbitrary names, SF zips map to curated neighborhoods, filter went case-insensitive.

**Gotchas**
- **Double-sell risk (open)**: claims don't write back to Eventbrite, so a spot confirmed on LastCall can still sell on Eventbrite. Production fix: write holds/orders through their API, or own ticketing for the promoted allotment.
- Eventbrite ticket prices are integer minor units (cents) in `cost.value`; `major_value` is the display string — use `value`.
- The Eventbrite docs site is a JS SPA — unusable via plain fetch; verify API details via search or a live call.
- Context7 MCP tools require interactive approval in this remote environment; use WebSearch/WebFetch for docs instead.

---

## 2026-07-25 — Concept, business plan, and MCP server scaffold

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g) · commit `99db14e`

**Shipped**
- Business concept ("LastCall"): perishable-inventory promotion marketplace — merchants post expiring inventory (empty seats, unsold tickets, open slots) as capped promotions; agents claim/redeem for users; merchants pay 12% only on redemption. SF chosen as wedge market (user is Sacramento-based; SF is close and agent-forward).
- Working TypeScript MCP server: 5 tools (`search_offers`, `get_offer`, `claim_offer`, `confirm_redemption`, `release_claim`), in-memory store behind a swappable `OfferStore` interface, seeded SF demo data, stdio + streamable HTTP transports, end-to-end smoke test (`npm run smoke`).

**Design decisions**
- **Pay-per-redemption, not impressions** — the merchant pitch that closes itself; fee split (`platform_fee`, `merchant_net`) surfaced in every receipt to keep the model legible.
- **Sponsored placement is bounded and always disclosed** (`sponsored: true` / `[SPONSORED]`) — placement is sellable, hiding it is not.
- **Anti-Groupon guardrails are structural**: per-offer quantity caps, claim deadlines, party-size limits, new-customers-only flags.
- Claims are 10-minute holds that lazily expire (every store operation sweeps lapsed holds; no background timers).
- Seed offer times are generated relative to server start so demos always have "tonight" inventory.
- Confirm is idempotent; claim/confirm tool descriptions instruct agents to get user approval first.

**Gotchas**
- MCP SDK: use `registerTool` with **Zod raw shapes** (`{foo: z.string()}`), not `z.object(...)`, for input schemas.
- stdio transport: **never log to stdout** — it's protocol traffic; stderr only.
- This repo (`vulnhunter`) is otherwise unrelated; LastCall lives entirely under `lastcall-mcp-server/`.
- Remote session containers are ephemeral — commit and push before ending any session.

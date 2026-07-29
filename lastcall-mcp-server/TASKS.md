# Tasks

Cross-session source of truth for LastCall work. Session details and the
reasoning behind completed items live in [WORKLOG.md](./WORKLOG.md).

Format: `- [ ] task — notes (added: date)` · completed items move to Done with
the session date that shipped them.

## In Progress

*(nothing — pick from backlog)*

## Backlog

### OSINT event ingestion (see [docs/OSINT-EVENT-SOURCING.md](./docs/OSINT-EVENT-SOURCING.md))
- [ ] Re-measure Phase-1 done-bar from a morning run: full-day event count for one SF day vs manual Funcheap/Chronicle spot-check (7pm run showed 19 events left in-window; needs a fair full-day measurement) (added: 2026-07-29)
- [ ] Funcheap venue merchant quality: many listings land on "Venue TBA" when location.name is empty — consider parsing venue from description/address (added: 2026-07-29)
- [ ] Grow the ICS feed list: find working civic feeds (SFPL/Rec & Parks event calendars don't expose obvious public ICS; investigate their platforms), more Meetup groups, Luma calendar ICS URLs (added: 2026-07-28)
- [ ] MONTHLY RRULE expansion (BYDAY ordinals like 2TU) — currently skipped with reasons (added: 2026-07-28)
- [ ] JSON-LD crawler follow-links mode: fetch per-event detail pages from calendar pages — the yield fix for venues whose calendars carry no inline JSON-LD (added: 2026-07-28)
- [ ] Prune/annotate the SF venue list from live-crawl findings; consider platform-specific fetchers for bot-walled venues (SFJAZZ, Exploratorium, de Young…) or cover them via aggregators instead (added: 2026-07-28)
- [ ] Phase 2 adapters: Luma calendars, 19hz.info, DoTheBay, newsletter-inbox pipeline (dedicated mailbox + LLM extraction) (added: 2026-07-25)
- [ ] Phase 3 adapters: Meetup public pages, Resident Advisor, Google Events (SerpApi) as gap-filler, Reddit weekly threads (added: 2026-07-25)
- [ ] Anchor enrichment: record corroborating listing sources on existing offers instead of only logging the merge (added: 2026-07-25)
- [ ] Phase-1 done-bar check: ≥50 deduplicated free+paid events for a given SF evening vs manual Funcheap/Chronicle spot-check (added: 2026-07-25)

### Platform
- [ ] Display-freshness reconciliation: periodically pull `offer_inventory` claimed counts so each instance's shown remaining matches the shared ledger between syncs (correctness already guaranteed at reserve time) (added: 2026-07-29)
- [ ] First analytics queries over event_snapshots: sell-through velocity by category/venue, sell-out prediction, discount-timing correlation (recorder is live; analysis unbuilt) (added: 2026-07-29)
- [ ] Snapshot event disappearance (event vanishing from a source is itself a signal — likely sold out or cancelled upstream) (added: 2026-07-29)
- [ ] Payments in confirm step — Stripe agentic checkout / Machine Payments Protocol (added: 2026-07-25)
- [ ] Eventbrite write-back: push holds/orders to Eventbrite to close the double-sell gap (see WORKLOG 2026-07-25 gotcha) (added: 2026-07-25)
- [ ] Per-merchant promotion rules engine (replace global `LASTCALL_EB_*` rule) (added: 2026-07-25)
- [ ] Auth + rate limiting for the HTTP transport (added: 2026-07-25)
- [ ] Cancellation/refund policy for confirmed bookings (added: 2026-07-25)
- [ ] More merchant feeds: Ticketmaster (merchant-side), Square/Toast, Mindbody (added: 2026-07-25)
- [ ] Merchant-facing MCP server (post/tune promos via the merchant's own agent) (added: 2026-07-25)
- [ ] Demand intelligence: aggregate query/claim analytics for merchant reporting (added: 2026-07-25)

### Business
- [ ] Test the loop end-to-end with a real Eventbrite account + test event (added: 2026-07-25)
- [ ] Get listed in MCP registries / connector directories once remotely deployable (added: 2026-07-25)
- [ ] Partnership outreach candidates: Funcheap, DoStuff network (DoTheBay) — link-out attribution first, data partnership later (added: 2026-07-25)

## Done

### Session 2026-07-29 (multi-instance claim path)
- [x] `offer_inventory` shared ledger + atomic reserve (conditional UPDATE + claim INSERT in one transaction); Postgres is the claim authority when configured
- [x] `ClaimCoordinator`: local-optimistic claim with rollback on shared-pool refusal; fail-closed when the database is unreachable; cross-instance confirm/release via claim adoption; shared expired-hold sweeps (pre-reserve + 1-min interval)
- [x] Feed-owned baselines pushed from every sync; seed baselines at boot
- [x] Integration suite rewritten as a two-instance simulation: oversell race (8 concurrent claims, exactly 5 wins, ledger 10/10), cross-instance confirm-by-code, release + third-instance re-claim, sweep, rehydration — verified on real PostgreSQL 16

### Session 2026-07-29 (Postgres + snapshots milestone)
- [x] Hybrid persistence: Postgres (`DATABASE_URL`) holds claims + merchants; listings stay in-memory; everything no-ops without a database
- [x] Boot rehydration: open claims restored, seats re-deducted (restart can't resell a confirmed spot); lapsed holds excluded
- [x] Analytics recorder: append-only `event_snapshots` (delta-only via fingerprints: remaining/price/start/corroboration) + `search_log` (filters + result counts, no user identity; zero-result searches included)
- [x] `npm run test:analytics` (delta logic, no-op safety) + `npm run test:pg` integration suite — verified against a real local PostgreSQL 16, including cross-process rehydration through the built server

### Session 2026-07-29 (Funcheap adapter — Phase 1 sources complete)
- [x] FuncheapAdapter: date-archive JSON-LD ingestion, SF region filter, title-paren + zip neighborhoods, keyword category inference, HTML entity decoding (shared `text.ts`), robots compliance, per-day error isolation
- [x] `npm run test:funcheap`; live yield: 251 listings / 209 free over 14 days
- [x] Full four-source live run: 405 raw → 371 deduplicated listings; three-source corroboration observed

### Session 2026-07-28 (ICS feed adapter)
- [x] Dependency-free iCalendar parser: unfolding, TZID/UTC/floating datetimes, escaping, DURATION, DAILY/WEEKLY RRULE expansion with INTERVAL/COUNT/UNTIL/EXDATE
- [x] IcsFeedAdapter with assumeFree pricing, LOCATION zip -> neighborhood, webcal:// normalization, per-feed error isolation
- [x] Curated feed list (live-verified Meetup group iCals); `npm run test:ics`
- [x] Live validation: 3 free listings incl. RRULE-expanded weekly hack nights

### Session 2026-07-28 (JSON-LD venue crawler)
- [x] Schema.org JSON-LD crawler adapter: robots.txt compliance, identifiable UA, per-venue error isolation, @graph/ItemList walking, stable hash IDs, naive-datetime → venue-local timezone handling
- [x] Curated SF venue seed list (23 venues, config-not-code)
- [x] Ingest anchor-filter fix for prefixed sources (`jsonld:<host>` no longer self-dedupes on re-sync)
- [x] `npm run test:jsonld` fixture suite; live validation runs (TM solo + combined TM+crawler with cross-source corroboration)

### Session 2026-07-25 (OSINT Phase 1 foundation)
- [x] Two-tier inventory model: `kind: "offer" | "listing"`, `source`/`sourceUrl`/`sources` provenance, `priceUnknown`; listings searchable, not claimable
- [x] `SourceAdapter` interface + shared ingest pipeline (per-adapter error isolation, ingest summaries)
- [x] Dedup/merge engine: title/venue token similarity + start ±45min, source precedence, provenance merge, offer-beats-listing anchor rule
- [x] Ticketmaster Discovery adapter (first OSINT source; SF city query, segment→category mapping, priceUnknown handling)
- [x] Search updates: `claimable_only`, `max_price=0` = free-only, listing rendering with link-outs; claim guard on listings
- [x] `npm run test:listings` fixture suite

### Session 2026-07-25 (tracking + OSINT plan)
- [x] TASKS.md + WORKLOG.md tracking system
- [x] OSINT event-sourcing research and plan (`docs/OSINT-EVENT-SOURCING.md`)

### Session 2026-07-25 (Eventbrite) — commit `aedaa91`
- [x] Eventbrite v3 API client (pagination, injectable fetch, actionable errors)
- [x] Promotion-rule mapper: under-sold paid events → offers (env-tunable rule)
- [x] Store `upsertInventory` with hold-preserving re-sync; startup + 30-min refresh
- [x] Fixture test suite (`npm run test:eventbrite`) — no token needed

### Session 2026-07-25 (scaffold) — commit `99db14e`
- [x] Business concept + revenue model (12% pay-per-redemption; SF wedge)
- [x] MCP server: 5 lifecycle tools, in-memory store, SF seed data, stdio + HTTP
- [x] End-to-end smoke test (`npm run smoke`)

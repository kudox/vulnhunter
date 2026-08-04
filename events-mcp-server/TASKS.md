# Tasks

Cross-session source of truth for LastCall work. Session details and the
reasoning behind completed items live in [WORKLOG.md](./WORKLOG.md).

Format: `- [ ] task — notes (added: date)` · completed items move to Done with
the session date that shipped them.

## In Progress

- [ ] Keep the history clock running (waiting on user) — Neon is live and the **first snapshot set is recorded** (427 events, 2026-07-29, written via Neon's HTTPS SQL API). Remaining: add `DATABASE_URL` + `TICKETMASTER_API_KEY` as GitHub Actions secrets, merge to default branch so the hourly `events-sync` workflow takes over, then verify one manual run shows fingerprints primed (~427) and near-zero new rows (added: 2026-07-29, updated: 2026-07-29)

## Backlog

### OSINT event ingestion (see [docs/OSINT-EVENT-SOURCING.md](./docs/OSINT-EVENT-SOURCING.md))
- [ ] Re-measure Phase-1 done-bar from a morning run: full-day event count for one SF day vs manual Funcheap/Chronicle spot-check (7pm run showed 19 events left in-window; needs a fair full-day measurement) (added: 2026-07-29)
- [ ] Funcheap venue merchant quality: many listings land on "Venue TBA" when location.name is empty — consider parsing venue from description/address (added: 2026-07-29)
- [ ] Grow the ICS feed list: find working civic feeds (SFPL/Rec & Parks event calendars don't expose obvious public ICS; investigate their platforms), more Meetup groups, Luma calendar ICS URLs; Sacramento community feeds (obvious Meetup slugs 404'd — try Sacramento365, city library, SacJS via their sites) (added: 2026-07-28, updated: 2026-07-29)
- [ ] MONTHLY RRULE expansion (BYDAY ordinals like 2TU) — currently skipped with reasons (added: 2026-07-28)
- [ ] JSON-LD crawler follow-links mode: fetch per-event detail pages from calendar pages — the yield fix for venues whose calendars carry no inline JSON-LD (added: 2026-07-28)
- [ ] Prune/annotate the SF venue list from live-crawl findings; consider platform-specific fetchers for bot-walled venues (SFJAZZ, Exploratorium, de Young…) or cover them via aggregators instead (added: 2026-07-28)
- [ ] Phase 2 adapters: Luma calendars, 19hz.info, DoTheBay, newsletter-inbox pipeline (dedicated mailbox + LLM extraction) (added: 2026-07-25)
- [ ] Phase 3 adapters: Meetup public pages, Resident Advisor, Google Events (SerpApi) as gap-filler, Reddit weekly threads (added: 2026-07-25)
- [ ] Anchor enrichment: record corroborating listing sources on existing offers instead of only logging the merge (added: 2026-07-25)
- [ ] Phase-1 done-bar check: ≥50 deduplicated free+paid events for a given SF evening vs manual Funcheap/Chronicle spot-check (added: 2026-07-25)

### Payments (strategy: [docs/PAYMENTS-STRATEGY.md](./docs/PAYMENTS-STRATEGY.md))
- [ ] Lane 2 — Eventbrite promo-code rail: mint single-use discount codes via the merchant's connected account at claim time; read redemption via ticket-class API; monthly fee billing. Ships first — smallest step to real revenue (added: 2026-07-29)
- [ ] Lane 1 — Stripe Connect: Express onboarding for direct merchants, destination charges with 12% `application_fee` in `confirm_redemption`, agentic checkout via MPP (added: 2026-07-29)
- [ ] Lane 3 — Impact affiliate tagging on Ticketmaster link-outs (afternoon-sized; review ToS re: sponsored contexts first) (added: 2026-07-29)
- [ ] Watch: agentic checkout announcements from ticketing platforms → re-evaluate Lane 3 (added: 2026-07-29)

### Platform
- [ ] Display-freshness reconciliation: periodically pull `offer_inventory` claimed counts so each instance's shown remaining matches the shared ledger between syncs (correctness already guaranteed at reserve time) (added: 2026-07-29)
- [ ] First analytics queries over event_snapshots: sell-through velocity by category/venue, sell-out prediction, discount-timing correlation (recorder is live; analysis unbuilt) (added: 2026-07-29)
- [ ] Snapshot event disappearance (event vanishing from a source is itself a signal — likely sold out or cancelled upstream) (added: 2026-07-29)
- [ ] Eventbrite write-back: push holds/orders to Eventbrite to close the double-sell gap (see WORKLOG 2026-07-25 gotcha) (added: 2026-07-25)
- [ ] Per-merchant promotion rules engine (replace global `EVENTS_EB_*` rule) (added: 2026-07-25)
- [ ] Auth + rate limiting for the HTTP transport (added: 2026-07-25)
- [ ] Cancellation/refund policy for confirmed bookings (added: 2026-07-25)
- [ ] More merchant feeds: Ticketmaster (merchant-side), Square/Toast, Mindbody (added: 2026-07-25)
- [ ] Merchant-facing MCP server (post/tune promos via the merchant's own agent) (added: 2026-07-25)
- [ ] Demand intelligence: aggregate query/claim analytics for merchant reporting (added: 2026-07-25)

### Business (pilot: [docs/MERCHANT-PILOT-PLAYBOOK.md](./docs/MERCHANT-PILOT-PLAYBOOK.md))
- [ ] Run the Lane-1 walk-in pilot: pick the city (Sacramento walkable vs SF strategic), print one-pagers + staff cards, target 5–10 merchants (comedy anchor vertical first) (added: 2026-07-29)
- [ ] Have a lawyer review the pilot agreement template before first signature (added: 2026-07-29)
- [ ] Lane-2 remote pilot: build the prospect list from snapshot data (low sell-through Eventbrite organizers) once a few weeks of history accumulate (added: 2026-07-29)
- [ ] Build the weekly merchant stats email (manual → scripted) — retention, conversion evidence, and demand-intelligence v0 in one artifact (added: 2026-07-29)
- [ ] Test the loop end-to-end with a real Eventbrite account + test event (added: 2026-07-25)
- [ ] Get listed in MCP registries / connector directories once remotely deployable (added: 2026-07-25)
- [ ] Partnership outreach candidates: Funcheap, DoStuff network (DoTheBay) — link-out attribution first, data partnership later (added: 2026-07-25)

## Done

### Session 2026-07-29 (sync worker + scheduled history)
- [x] One-shot sync worker (`npm run sync` / `dist/sync.js`): all configured sources once, snapshots recorded, clean exit; seed data off by default; dry-run warning without DATABASE_URL
- [x] Shared sync module (`services/sources.ts`) — server intervals and the worker run one code path
- [x] Cross-process delta suppression: fingerprints primed from `event_snapshots` on startup (found live: fresh worker processes were re-recording all 432 events per run; after fix, run 3 added zero rows)
- [x] GitHub Actions hourly schedule (`.github/workflows/events-sync.yml`) — needs secrets + default-branch merge to fire
- [x] Live-verified against real Postgres: 3 worker runs, 432 events, 864 rows (first-sight ×1 + pre-fix duplicate set), zero growth once primed

### Session 2026-07-29 (Sacramento market — dogfooding)
- [x] Multi-market Ticketmaster adapter (`TICKETMASTER_MARKETS`, default SF + Sacramento)
- [x] Sacramento zip → neighborhood mapping (Midtown, Downtown, East Sac, Land Park, Oak Park, Tahoe Park, Natomas, Arden-Arcade) + NEIGHBORHOODS additions
- [x] Sacramento venue crawl targets (Ace of Spades, Punch Line Sac — both live-verified JSON-LD) in the renamed market-neutral `venues.ts`/`icsFeedList.ts`
- [x] 4 Sacramento seed merchants/offers so the claim flow dogfoods locally
- [x] Live-validated: 210 TM events across both markets, 68 Sacramento listings, 20 Sac events multi-source corroborated

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

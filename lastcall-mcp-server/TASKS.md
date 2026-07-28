# Tasks

Cross-session source of truth for LastCall work. Session details and the
reasoning behind completed items live in [WORKLOG.md](./WORKLOG.md).

Format: `- [ ] task — notes (added: date)` · completed items move to Done with
the session date that shipped them.

## In Progress

*(nothing — pick from backlog)*

## Backlog

### OSINT event ingestion (see [docs/OSINT-EVENT-SOURCING.md](./docs/OSINT-EVENT-SOURCING.md))
- [ ] Remaining Phase 1 adapters: ICS feed set (SFPL, Rec & Parks), Funcheap (added: 2026-07-25)
- [ ] JSON-LD crawler follow-links mode: fetch per-event detail pages from calendar pages — the yield fix for venues whose calendars carry no inline JSON-LD (added: 2026-07-28)
- [ ] Prune/annotate the SF venue list from live-crawl findings; consider platform-specific fetchers for bot-walled venues (SFJAZZ, Exploratorium, de Young…) or cover them via aggregators instead (added: 2026-07-28)
- [ ] Phase 2 adapters: Luma calendars, 19hz.info, DoTheBay, newsletter-inbox pipeline (dedicated mailbox + LLM extraction) (added: 2026-07-25)
- [ ] Phase 3 adapters: Meetup public pages, Resident Advisor, Google Events (SerpApi) as gap-filler, Reddit weekly threads (added: 2026-07-25)
- [ ] Anchor enrichment: record corroborating listing sources on existing offers instead of only logging the merge (added: 2026-07-25)
- [ ] Phase-1 done-bar check: ≥50 deduplicated free+paid events for a given SF evening vs manual Funcheap/Chronicle spot-check (added: 2026-07-25)

### Platform
- [ ] Postgres `OfferStore` implementation (row-level locking on claims) (added: 2026-07-25)
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

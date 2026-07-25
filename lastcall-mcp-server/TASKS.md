# Tasks

Cross-session source of truth for LastCall work. Session details and the
reasoning behind completed items live in [WORKLOG.md](./WORKLOG.md).

Format: `- [ ] task — notes (added: date)` · completed items move to Done with
the session date that shipped them.

## In Progress

*(nothing — pick from backlog)*

## Backlog

### OSINT event ingestion (see [docs/OSINT-EVENT-SOURCING.md](./docs/OSINT-EVENT-SOURCING.md))
- [ ] Two-tier inventory model: add `kind: "offer" | "listing"` + `source`/`sourceUrl` provenance to the domain model; listings are searchable but not claimable (added: 2026-07-25)
- [ ] `SourceAdapter` interface + normalizer (category/neighborhood mapping, timezone handling) (added: 2026-07-25)
- [ ] Dedup/merge engine: fuzzy (title, venue, start-time window) keying with source-precedence rules (added: 2026-07-25)
- [ ] Phase 1 adapters: Ticketmaster Discovery API, schema.org JSON-LD venue crawler (seed ~30 SF venues), ICS feed set (SFPL, Rec & Parks), Funcheap (added: 2026-07-25)
- [ ] Phase 2 adapters: Luma calendars, 19hz.info, DoTheBay, newsletter-inbox pipeline (dedicated mailbox + LLM extraction) (added: 2026-07-25)
- [ ] Phase 3 adapters: Meetup public pages, Resident Advisor, Google Events (SerpApi) as gap-filler, Reddit weekly threads (added: 2026-07-25)
- [ ] Search tool updates: `claimable_only` filter, listing rendering with link-outs and attribution (added: 2026-07-25)

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

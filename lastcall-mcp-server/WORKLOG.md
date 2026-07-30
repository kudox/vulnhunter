# Work Log

Session-by-session record of work done, design decisions, and gotchas worth
remembering. Newest first. Update this at the end of any session that ships
meaningful work.

Conventions: each entry lists what shipped (with commits), the decisions that
will constrain future work, and gotchas — things that cost time or will bite
again if forgotten.

---

## 2026-07-29 — Database strategy decided (docs/DATABASE-STRATEGY.md)

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Decision**: **Neon** now (scale-to-zero matches the hourly sync worker; post-Databricks pricing favorable), with the vendor choice deliberately low-stakes because of two architectural facts recorded in the doc:
1. **LastCall shards perfectly by city** (no cross-city transaction will ever exist) → distributed-write databases are the wrong problem; Europe = a separate regional cluster (GDPR argues for it anyway); max topology = N regional Postgres clusters.
2. **Two workloads, one schema**: tiny OLTP core (claims) + huge append-only time-series (snapshots, 95%+ of volume) → the real national-scale move is graduating history to ClickHouse/Tinybird, not swapping OLTP vendors.

Scale math: full US+EU coverage ≈ 1–2M active events, tens of millions of snapshot rows/month — one partitioned Postgres carries it. Supabase noted as honest second place (bundled auth for the future merchant dashboard, but no scale-to-zero). Doc includes the concrete Neon setup runbook (project → secrets → default-branch merge → two-run validation → verification SQL).

---

## 2026-07-29 — Sync worker + scheduled history accumulation

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Context**: user asked whether polling was interval-based or manual. Honest answer: interval-based *but only while a server runs*, and nothing runs anywhere — every live number so far came from one-off manual runs; **zero history had accumulated**. This milestone makes accumulation unattended.

**Shipped**
- `src/sync.ts` one-shot worker (`npm run sync`): all configured sources once, snapshots/baselines recorded, clean exit with per-source summary; exit 1 only when configured work failed. Seed (fictional) data defaults **off** so demo offers never enter the history tables.
- `src/services/sources.ts`: sync logic extracted from index.ts so the server's interval loops and the worker run one code path.
- `.github/workflows/lastcall-sync.yml` (repo root): hourly schedule + manual dispatch; needs `DATABASE_URL` and `TICKETMASTER_API_KEY` repo secrets. **GitHub only fires schedules from the default branch** — inert until merged there.
- **Cross-process delta fix**: fresh worker processes re-recorded all events every run (fingerprint cache was per-process; live runs 1+2 wrote exactly 2×432 rows). `Analytics.primeFingerprints()` now loads the latest fingerprint per event from `event_snapshots` on startup (`composeFingerprint` shared between recorder and primer so they can't drift). Live run 3: 432 primed, **zero rows added**.

**Live validation (local PostgreSQL 16, real keys)**
- 3 worker runs: 432 listings in view (both markets, all four sources), 132 Sacramento snapshot rows, run-3 growth zero. Worker runtime ~35–55s — comfortably inside GitHub Actions free-tier budget at hourly cadence.

**Gotchas**
- **Delta-only recording must survive process boundaries** — an in-memory-only fingerprint cache silently 10×'s the snapshot volume and breaks "row = change" semantics precisely in the scheduled-worker mode the recorder exists for. Caught only because the live validation checked row counts across runs.
- GitHub Actions `schedule:` triggers run exclusively from the default branch; `workflow_dispatch` works from any branch.

---

## 2026-07-29 — Sacramento market added (dogfooding)

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Shipped**
- Ticketmaster adapter is multi-market: `markets: TmMarket[]`, env `TICKETMASTER_MARKETS="San Francisco,CA;Sacramento,CA"` (the default), single-market `TICKETMASTER_CITY` kept for compat.
- Sacramento zips → neighborhoods in the shared map (renamed `neighborhoodForZip`); Sacramento entries in `NEIGHBORHOODS`; `CITY` constant now "San Francisco & Sacramento" (flows into tool descriptions).
- Curated lists renamed market-neutral (`venues.ts` / `icsFeedList.ts`, exports `CURATED_*`); Sacramento venue crawl targets added after live probing: **Ace of Spades and Punch Line Sac both emit JSON-LD (25 events each — Live Nation platform, as with Fillmore/Cobb's)**; Crest + Goldfield bot-wall (403); Harlow's/Comedy Spot homepages carry no events.
- 4 fictional Sacramento seed merchants/offers (Midtown listening room, Downtown pizzeria, East Sac yoga, Land Park comedy) so the claim lifecycle dogfoods locally.

**Live validation (2026-07-29)**
- TM both markets: **210 events ingested** (was 142 SF-only); with the Sac venue crawlers: 34 merged, 196 upserted. **Sacramento view: 68 live listings + 4 seed offers**, 20 Sac events multi-source corroborated. Real inventory: touring Broadway at SAFE Credit Union PAC, films at the Crest, Cal Expo shows, Punch Line comedy.
- Nice systemic catch: the Crest bot-walls the crawler, but Ticketmaster's API carries its events anyway — API-first sourcing routes around bot walls.
- Sacramento Meetup iCal slugs all guessed wrong (404s) — finding Sac community feeds (Sacramento365, library) backlogged.

---

## 2026-07-29 — Merchant pilot playbook (docs/MERCHANT-PILOT-PLAYBOOK.md)

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Drafted** the supply-side plan answering "how do I even approach merchants":
- **Trust ladder**: crawl (pay-at-door, LastCall handles no money, 60 days free) → walk (Stripe prepay + 12%) → run (rules engine). Don't skip crawl — the pilot manufactures the redemption stats that make the paid ask trivial.
- Pilot design: 5–10 clustered merchants, manual onboarding (you are the dashboard), the Monday stats email as retention/conversion/demand-intelligence-v0 in one artifact.
- Targets in order: comedy clubs ("papering the room" is an existing habit — automate it, don't create it), owner-operated food/drink with a dead window, fitness studios. ~3 yeses per 10 asks is the expected rate.
- Lane-2 variant is remote/email — prospect list generated from our own snapshot data (low sell-through organizers); OAuth or a merchant-created code batch as the low-trust rung. Geography insight: Lane-1 walk-ins can pilot in Sacramento (where the user's feet are) while listings keep building the SF story.
- Make-good policy (instant refund, one conversation, delist) budgeted as pilot cost; explicit success criteria (≥10 redemptions/merchant, ≥3 conversions) with both failure modes read as information.
- Appendices: walk-in pitch script, one-page pilot agreement template (flagged for lawyer review), staff instruction card.

---

## 2026-07-29 — Payments strategy decided (docs/PAYMENTS-STRATEGY.md)

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Decision** — "how do payments wire into merchant systems" splits into three lanes, and in two of them LastCall deliberately stays OUT of the money flow:
1. **Direct-merchant offers → Stripe Connect** (destination charges, 12% `application_fee`, merchant is merchant-of-record). No merchant-system integration exists or is needed.
2. **Eventbrite-connected merchants → promo-code rail**: mint single-use discount codes via the merchant's own connected account at claim time; checkout stays on Eventbrite; redemption read via the ticket-class API; fee billed monthly. No payment processing, airtight attribution, and it kills the double-sell gotcha (Eventbrite's ledger is the only ledger). Ships before Stripe.
3. **OSINT listings → affiliate-tagged link-outs**: Ticketmaster's Impact program is real but pays ~1%/~$0.30 — two orders of magnitude below the 12% core model. Tag the links (free pennies + click data), never rank by commission.

**Key numbers**: $60 ticket → $0.60 affiliate vs $7.20 redemption fee. Watch item: agentic-checkout protocols could convert Lane 3 into in-conversation purchasing; don't pursue Ticketmaster's gated Partner APIs now.

TASKS.md payments backlog restructured around the three lanes (build order: promo-code rail → Stripe Connect → affiliate tags).

---

## 2026-07-29 — Multi-instance claim path

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Shipped**
- `offer_inventory` shared ledger (`baseline` feed-owned, `claimed` database-owned) and `db.reserveAndInsertClaim`: conditional `UPDATE ... WHERE claimed + N <= baseline` + claim `INSERT` in one transaction — the row lock serializes claimers across every instance sharing the database.
- `ClaimCoordinator` (`src/services/claims.ts`), now the tools' mutation path: db-less it delegates to the store; with a database it claims local-optimistic then reserves in Postgres, rolling the local hold back on refusal (honest sold-out) or on database error (**fail-closed**: never trade oversell-safety for availability). Confirm/release adopt unknown claims from Postgres by id/code, so any instance can finish any claim. Expired holds sweep in Postgres pre-reserve and on a 1-minute interval.
- Baselines: every Eventbrite sync pushes pre-deduction availability; seed offers seeded at boot.

**Live validation (real PostgreSQL 16, two simulated instances with separate stores sharing one DB)**
- **Oversell race**: 10-spot offer, 8 concurrent party-of-2 claims split across two instances → exactly 5 wins, losers see `sold_out`, ledger reads exactly 10/10. The core guarantee, observed.
- Cross-instance confirm-by-code (adoption), release returning seats that a third instance then claimed, sweep freeing a lapsed hold, rehydration excluding swept holds — all green; all seven DB-free suites unaffected.

**Design decisions**
- Local-optimistic ordering (store first, then Postgres) keeps all the good error messages and the store race-free path, at the cost of a momentary local hold that may roll back — invisible to callers.
- Fail-closed on DB unavailability for claims specifically; reads/search stay up (they don't need the ledger).
- Display freshness is best-effort between syncs and stated as such in the README; the reserve step is the correctness boundary. Reconciliation pass backlogged.

**Gotchas**
- A cross-instance confirm *adopts* the claim into the confirming instance's store — tests (and future code) must not assume "claims in store B were created by B". Bit the integration test's release-target selection first.

---

## 2026-07-29 — Postgres + snapshots milestone

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Shipped**
- Hybrid persistence (`DATABASE_URL` enables; everything no-ops without it): Postgres holds **claims + merchants** (the money path) while listings remain the in-memory cache rebuilt from sources. `src/services/db.ts` (pg Pool, idempotent schema) + `src/services/analytics.ts` (fire-and-forget, failure-isolated writes — a DB hiccup logs and never breaks serving).
- Boot rehydration: `loadOpenClaims` restores active holds + future confirmations; `store.restoreClaim` re-deducts seats for present offers, and `upsertInventory`'s active-claims deduction covers offers arriving in later syncs. A restart can't resell a confirmed spot.
- **Analytics recorder** (the can't-backfill asset): append-only `event_snapshots` written delta-only via fingerprints (remaining, total, price, priceUnknown, startsAt, corroboration count — cosmetic text changes deliberately don't trigger rows); `search_log` capturing filters + result counts per search including zero-result searches (unmet demand), never user identity. Wired into every sync loop and every claim/confirm/release mutation.
- Tests: `test:analytics` (pure delta logic + no-op safety, DB-free) and `test:pg` (real-database integration; auto-skips without DATABASE_URL so `npm test` stays hermetic).

**Live validation (2026-07-29, local PostgreSQL 16)**
- Integration suite green against a real database: idempotent schema, claim status transitions, rehydration excluding lapsed holds, inventory re-deduction, table-level delta-only verification (mutated event: exactly 2 rows), search log.
- Built server booted against the same DB and logged `1 open claim(s) rehydrated` — a claim persisted by one process restored by another, which is the whole point.

**Design decisions**
- **Single-node write-behind, stated honestly**: the synchronous in-memory store remains the decision-maker; Postgres follows asynchronously. Race-free within one process (single-threaded JS); multi-instance sharing needs the atomic `UPDATE ... WHERE remaining >= N RETURNING` claim path — backlogged, not pretended.
- Kept the `OfferStore` interface synchronous — persistence hooks live in the tools/sync layer (`Analytics`), so the six existing fixture suites and `InMemoryOfferStore` are untouched.
- Snapshot fingerprint includes corroboration-source count (new source confirming an event is signal) and startsAt (reschedules matter); description/title changes don't trigger rows.
- Privacy line held at the schema: `search_log` has no user column at all.

**Gotchas**
- `initdb` refuses to run as root (remote containers run as root) — `su postgres -s /bin/bash -c ...` with a data dir the postgres user can traverse (`/tmp/...`, not the root-owned scratchpad).
- Analytics writes are fire-and-forget, so tests must allow a settle beat before asserting table contents.

---

## 2026-07-29 — Funcheap adapter: Phase-1 sources complete

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Shipped**
- `FuncheapAdapter` (`LASTCALL_FUNCHEAP=on`): loops the next 14 date-archive pages (`sf.funcheap.com/YYYY/MM/DD/`, Pacific-date URLs), reusing the JSON-LD crawler's extraction. SF region filter (their coverage spans the Bay), neighborhood from title parentheticals + address zips, keyword category inference, WordPress HTML-entity decoding (new shared `src/services/text.ts`).
- Probing before building paid off: robots.txt allows archives (only `/search/` disallowed), the WP REST API is open but posts carry *publish* dates not event dates — the archive pages' embedded schema.org Event list (with explicit `offers.price`, 0 = free, and offset-qualified datetimes) is the right surface by far.

**Live validation (2026-07-29)**
- Funcheap alone: **251 listings over 14 days, 209 free** — the single densest free-event source, as the OSINT plan predicted.
- Full four-source run (TM + venue crawler + ICS + Funcheap): 405 raw → **34 cross-source merges → 371 deduplicated listings + 16 seed offers**; 9 events multi-source corroborated including one three-source event (Cobb's "Get It?! Gameshow": ticketmaster + venue JSON-LD + funcheap).
- Done-bar caveat recorded honestly: the 12h "tonight" window measured 19 events, but the run happened at 7pm PT when most of the evening had started; needs a morning re-measurement (backlogged).

**Gotchas**
- Funcheap's JSON-LD text is WordPress HTML-entity-encoded (`&#8220;`, `&#038;`) — decode titles/descriptions/venues or agent-facing output is full of `&#8217;`.
- Their `location.address` is a plain string (not a PostalAddress object) and often zipless; title parentheticals ("… (SoMa)") are the more reliable neighborhood signal.
- Many events have empty `location.name` → "Venue TBA" merchants; venue-quality backfill backlogged.
- Empty archive days 404 — treat as normal, not an error.

---

## 2026-07-28 — ICS feed adapter (OSINT source #3, the free-event layer)

**Session**: [claude.ai/code session 01Xepb…](https://claude.ai/code/session_01XepbXrDVqstRRrP3nZzz4g)

**Shipped**
- Dependency-free iCalendar parser (`src/services/ics.ts`): RFC 5545 line unfolding, TZID/UTC/floating datetime handling (reusing the shared naive-tz logic, now in `src/services/dates.ts`), text unescaping, DURATION parsing, and limited RRULE expansion — DAILY/WEEKLY with INTERVAL/COUNT/UNTIL/EXDATE; MONTHLY+ and ordinal BYDAY skipped with logged reasons rather than mis-expanded.
- `IcsFeedAdapter` (`ics:<host>` sources, precedence 60): `assumeFree` feeds yield $0 listings (iCalendar has no price field), LOCATION zip regex → neighborhood, `webcal://` normalization, per-feed error isolation. Opt-in via `LASTCALL_ICS=on`; `LASTCALL_ICS_FEEDS` override.
- `npm run test:ics` fixture suite.

**Live validation (2026-07-28)**
- **Meetup group iCals survived the 2025 API lockdown** — `meetup.com/<group>/events/ical/` is public, no auth. This is the practical Meetup route (better than the page-scraping fallback the OSINT plan assumed).
- Yield: 3 free listings from verified feeds — SF Civic Tech's weekly hack night correctly RRULE-expanded into 2 occurrences, plus a real SF Python meetup. Feed probing found sfpython/sfruby/sfnode live, many candidate group slugs 404.
- The original Noisebridge Google Calendar URL is dead — curated list now holds only live-verified feeds; dead-feed pruning via per-feed sync logs works as designed.

**Gotchas**
- RFC 5545 unfolding removes CRLF + exactly **one** whitespace char — a folded line preserving a real space needs two leading spaces. My first test fixture got this wrong, not the parser.
- Meetup iCal DTSTARTs come with TZID params; Google Calendar public feeds use UTC Z-times; both paths needed.
- SFPL and SF Rec & Parks don't expose obvious public ICS endpoints (their platforms hide them) — finding proper civic feeds is a real research task, backlogged; Meetup groups carry the free-tier torch meanwhile.

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
- **Don't pin test clocks to a fixed date**: the store's lazy hold-sweep uses wall-clock time, so tests that pinned NOW to their writing date broke days later (fresh holds looked expired). Test NOW must be `new Date()` with all fixture times as relative offsets (fixed in `11f3cd6`).

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

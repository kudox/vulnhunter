# OSINT Event Sourcing Plan

*Drafted 2026-07-25. Goal: make LastCall's answer to "what's happening tonight?"
complete — free events and non-merchant events included — not just inventory
from paying merchants.*

## Why this matters strategically

An agent will adopt exactly one "local events" tool: the one that answers
completely. If LastCall only returns paid offers from connected merchants, an
agent (or its user) learns to also check somewhere else — and that somewhere
else eventually eats the category. Free and non-customer events are the
**demand-side moat**; monetization stays on claimable offers.

This creates a **two-tier inventory model**:

| | **Offers** (existing) | **Listings** (new) |
|---|---|---|
| Source | Connected merchants (Eventbrite sync, future feeds) | OSINT ingestion (this doc) |
| Claimable | Yes — hold → confirm → fee | No — informational, link out to source |
| Revenue | 12% per redemption | None directly; drives adoption + conversion funnel |
| Trust posture | We control terms | Attribution + provenance always shown |

Listings are also the **merchant acquisition funnel**: "Your show appeared in
1,200 agent answers last month as a plain listing. Merchants with offers
convert those into claimed seats" is a self-serving sales pitch built from our
own data. And a listing whose venue later signs up upgrades in place to an
offer.

---

## Source inventory, tiered by effectiveness

Ranking weighs: volume × free-event density × structure (parse cost) ×
stability × legal cleanliness. SF wedge market; generalization noted where it
matters.

### Tier 1 — Structured APIs and machine-readable feeds (build first)

**1. Ticketmaster Discovery API** — the anchor for big-venue coverage.
Genuinely public search API (unlike Eventbrite): geo, date-range, and
classification queries; free tier is 5,000 calls/day at 5 req/s, far more than
a metro sync needs. Covers Live Nation venues (Fillmore, Masonic, etc.),
sports, arenas. Low free-event density but high mainstream volume, and it
generalizes to any US metro instantly.

**2. Schema.org JSON-LD crawler over venue websites** — the highest-leverage
build. Most venue/ticketing pages embed `Event` structured data (they do it
for Google). One generic parser + a curated seed list of ~30 SF venue domains
covers independent venues no API reaches: SFJAZZ, Great American Music Hall,
The Independent, The Chapel, Bottom of the Hill, Rickshaw Stop, DNA Lounge,
Cafe du Nord, Roxie and Castro theaters, SFMOMA, de Young, Exploratorium,
Academy of Sciences, Commonwealth Club, City Arts & Lectures… The venue list
is config, not code — adding a venue is adding a URL. Also the mechanism by
which "venue you found via other sources" becomes "venue we monitor."

**3. ICS/iCal feeds** — the free-event goldmine nobody bothers with.
Libraries (SFPL publishes extensive event calendars), SF Rec & Parks,
universities, churches, community centers, and many orgs expose `.ics` or
public Google Calendars. Zero parsing ambiguity (it's a standard), extremely
stable, and skewed heavily toward exactly the free community events we lack.

**4. Luma (lu.ma)** — owns SF tech/founder/AI events, which in this city is a
major category. Public calendar pages per organizer, ICS export per calendar,
explore pages for discovery. Structured, dense, and the audience overlaps
heavily with early agent users.

**5. Google Events via SerpApi (or similar)** — the breadth backstop. Google
aggregates schema.org events from the entire web; SerpApi returns them as
structured JSON (title, date, venue, ticket links). Costs money per search
(~$75/5k), so use it as (a) a gap-filler for categories where our direct
sources are thin and (b) a **discovery mechanism**: any venue that appears
here but isn't in our JSON-LD crawl list gets added to it. Not a primary
source — a completeness audit that also feeds Tier 1 #2.

### Tier 2 — Local aggregators and curators (SF-specific density)

**6. Funcheap SF** — *the* free/cheap event source for SF: ~50 hand-picked
events/week, free-museum days, street festivals, oddball one-offs no API
carries. Site is WordPress-based with date-indexed pages (`/today/`,
`/weekend/`) and feeds; also a newsletter (see Tier 3). Start with polite
scraping + prominent link-out attribution; pursue a partnership — they live on
traffic, and we send them exactly that.

**7. DoTheBay (DoStuff network)** — nightlife/concert density, structured
event pages with JSON-LD. Strategic bonus: DoStuff runs the same platform in
~20 metros (DoLA, Do312…), so one adapter is a multi-city expansion lever, and
the network is a natural partnership target.

**8. 19hz.info** — comprehensive Bay Area electronic-music listings in a
famously plain HTML table. Trivial to parse, lovingly maintained, covers the
warehouse/club scene that mainstream sources miss entirely.

**9. Resident Advisor** — global electronic events with an unofficial GraphQL
API. Overlaps 19hz for SF but adds ticket links and images; fragile
(unofficial), so treat as enrichment, not backbone.

**10. Meetup** — free community events at volume, but the open API died in
Feb 2025 (GraphQL now requires auth; meaningful access needs Meetup Pro). The
practical route is public event/group pages, which still embed JSON-LD and
`__NEXT_DATA__`. Rate-limit respectfully; treat as Phase 3.

**11. Eventbrite public pages** — public event pages carry JSON-LD too, and
free events (their bread and butter) are searchable on-site even though the
API isn't. **Deliberately deprioritized**: we want Eventbrite as the platform
merchants connect through, not a scraping adversary; ToS risk isn't worth it
while the merchant-connected channel exists. Revisit only if a partnership or
official feed emerges.

### Tier 3 — Editorial, newsletters, and civic sources (LLM-extraction era)

**12. Newsletter ingestion pipeline** — the sleeper. Stand up a dedicated
mailbox subscribed to: Funcheap, DoTheBay, SF Chronicle Datebook, SFist,
Broke-Ass Stuart, The Bold Italic, venue mailing lists, Luma digests. Inbound
email → LLM extraction → candidate events with source attribution. Newsletters
are *pre-curated by local editors* — the taste layer no API has — and LLM
extraction has collapsed what used to be the hard part. This pipeline also
future-proofs us: any new source that has a newsletter is onboarded by
subscribing.

**13. Local news event roundups** — SFGate/Chronicle Datebook, SFist, Mission
Local, 48 Hills weekly "things to do" posts. RSS + LLM extraction, same
pipeline as #12. Catches street fairs, festivals, and neighborhood events.

**14. Civic/open data** — DataSF special-event permits (street closures are a
*leading indicator* of festivals before they're announced anywhere), SF Rec &
Parks, SFPL (also in #3 via ICS), farmers-market schedules. Uniquely: this
data is explicitly public-domain, zero legal ambiguity, and nobody else uses
it well.

### Tier 4 — Social (high effort, fragile; do last or via consent)

**15. Reddit** — r/sanfrancisco and r/bayarea weekly event threads;
API-accessible, LLM-extractable. Low volume, high "local color."
**16. Instagram** — where small venues/promoters actually announce. Actively
anti-scraping; only viable as a *merchant-connected* channel ("connect your
IG, we'll parse your posts into listings") — that's consent, not OSINT. Park it.
**17. Facebook Events** — API locked down years ago; effectively inaccessible
at scale. Skip.
**18. X/Twitter** — paid API, low event density. Skip.

---

## Architecture

```
adapters (one per source)          normalize          dedup/merge         store
┌─────────────────────┐      ┌──────────────────┐   ┌─────────────┐   ┌──────────┐
│ ticketmaster.ts     │      │ category map     │   │ fuzzy key:  │   │ upsert   │
│ jsonldCrawler.ts    │ ───> │ zip→neighborhood │──>│ (title,     │──>│ Inventory│
│ icsFeeds.ts         │      │ tz handling      │   │  venue,     │   │ (exists) │
│ funcheap.ts  …      │      │ price parsing    │   │  start±30m) │   └──────────┘
└─────────────────────┘      └──────────────────┘   │ + precedence│
        each → RawEvent[]                            └─────────────┘
```

- **`SourceAdapter` interface**: `fetch(since: Date): Promise<RawEvent[]>` —
  mirrors the Eventbrite pattern (injectable fetch, pure mappers, fixture
  tests per adapter). Adapters are dumb; normalization is shared.
- **Dedup is the hard part** — the same show will arrive from the venue's
  JSON-LD, Ticketmaster, DoTheBay, and a newsletter. Key on fuzzy
  (normalized title, venue, start-time ±30min); merge with source precedence:
  ticketing API > venue site > aggregator > newsletter/LLM-extracted. Keep all
  provenance (`sources: [...]`) — multi-source confirmation is a quality
  signal we can rank on.
- **Listings in the domain model**: `kind: "offer" | "listing"`, optional
  price, required `source` + `sourceUrl`. Search returns both (listings render
  with attribution + link-out); claim tools reject listings with a pointer to
  the source URL. New `claimable_only` search filter.
- **Freshness**: per-source TTL; a listing not re-confirmed by its source for
  2 sync cycles is dropped (stale event data is worse than none).

## Ground rules (legal/ethical)

1. Prefer, in order: official APIs → published feeds (ICS/RSS/JSON-LD, which
   exists *to be machine-read*) → polite scraping (robots.txt, rate limits,
   identifiable UA) → never: auth walls, anti-bot circumvention.
2. Always attribute and link out. We're sending aggregators/venues traffic,
   not replacing them — this is also what makes partnerships offerable later.
3. Facts (event exists, when, where) aren't copyrightable; editorial prose is —
   store facts, write our own descriptions for listings from editorial sources.
4. Per-source kill switch, because any scraped source can object or break.

## Phasing

| Phase | Sources | Rationale |
|---|---|---|
| **1** | Listing model + dedup v1; Ticketmaster API; JSON-LD crawler (~30 seed venues); ICS set (SFPL, Rec & Parks); Funcheap | Anchor coverage: mainstream + independent venues + free civic events + curated free/cheap. All structured or near-structured. |
| **2** | Luma; 19hz; DoTheBay; newsletter inbox pipeline | Category depth (tech, electronic, nightlife) + the editorial taste layer. |
| **3** | Meetup public pages; Resident Advisor; SerpApi gap-filler + venue discovery; Reddit threads | Long-tail completeness; SerpApi audit feeds new venues back into the Phase-1 crawler. |
| **4** | Partnerships (Funcheap, DoStuff); merchant-connected Instagram | Convert scrape relationships into data relationships; social via consent. |

**Definition of done for Phase 1**: for any given SF evening, `events_search_offers`
returns ≥50 events spanning free and paid, with zero duplicate visible entries
and every listing attributed — measured against a manual Funcheap+Chronicle
spot-check for the same evening.

## Reference links

- Ticketmaster Discovery API: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
- Meetup API status (post-2025 lockdown): https://help.meetup.com/hc/en-us/articles/41453576628749-How-can-I-get-access-to-Meetup-s-API and https://logiover.com/guides/meetup-api-alternative-event-group-data/
- Funcheap: https://sf.funcheap.com/ (free: https://sf.funcheap.com/free-events/, today: https://sf.funcheap.com/today/)
- DoTheBay: https://dothebay.com/ · 19hz: https://19hz.info/ · Luma: https://lu.ma/sf
- SerpApi Google Events: https://serpapi.com/google-events-api
- DataSF: https://datasf.org/opendata/ · SFPL events: https://sfpl.org/events · SF Rec & Parks: https://sfrecpark.org/

# Database Strategy

*Decided 2026-07-29. Companion to [PAYMENTS-STRATEGY.md](./PAYMENTS-STRATEGY.md).
Question answered: which database vendor fits now AND supports growth to every
major US city, potentially every city in the US/Europe?*

**Decision: Neon now. The vendor choice is deliberately low-stakes because of
two architectural facts — the real "national scale" moves are an
OLTP/analytics split and regional clusters, not a fancier database.**

## The two facts that shape everything

**1. LastCall shards perfectly by city.** No transaction ever spans two
cities — a claim in Sacramento never touches a row in Berlin. Therefore
globally-distributed-write databases (CockroachDB, Yugabyte, Spanner) solve a
problem this business will never have. Europe, when it happens, is a
**separate EU cluster** — which GDPR/data-residency argues for anyway. The
maximum topology this company ever needs is N regional Postgres clusters.

Scale math: ~300 US metros + broad EU coverage ≈ 1–2M *active* events at any
time. With delta-only snapshots, that's tens of millions of rows/month at
full continental scale — a few hundred GB/year. One well-partitioned Postgres
carries that without drama. "National scale" here means a bigger Postgres,
not a different species of database.

**2. The data is two workloads wearing one schema.** A tiny transactional
core (claims, merchants — thousands of rows, sacred) and a huge append-only
time-series (event_snapshots, search_log — 95%+ of volume, the analytics
moat). The eventual scale move is graduating the history tables to a columnar
store — **ClickHouse** (or Tinybird managed) is the endgame for the
demand-intelligence product; Timescale is the stay-inside-Postgres middle
option. Claims stay in boring Postgres forever. Today's vendor only needs to
carry the OLTP core plus a few years of history — everything considered can.

**Portability discipline (already in place):** vanilla SQL, no exotic
extensions, standard `pg` driver. Any vendor below is reachable via
`pg_dump`/logical replication with minutes of downtime. This decision is
reversible; keep it that way.

## Vendor assessment (2026)

| Option | Now | At scale | Verdict |
|---|---|---|---|
| **Neon** | Excellent | Good | **Chosen.** Scale-to-zero matches the hourly sync worker (DB sleeps ~55 min/hour → free tier lasts). Post-Databricks-acquisition (May 2025) pricing dropped hard (storage $1.75→$0.35/GB-mo, minimums removed). Databricks ownership is a plus for the analytics future. |
| **Supabase** | Excellent | Good | Honest second place. Bundled auth/storage/realtime + PostGIS could save real time when the merchant dashboard gets built — at the cost of always-on compute (no scale-to-zero). Revisit at dashboard time. |
| **PlanetScale Postgres** | Fine | Strong | New (2025), performance-pitched, no meaningful free tier. A "when revenue exists" option. |
| **Aurora / AlloyDB** | Overkill | The boring winner | Where scaled companies land. Migrating later is solved; starting now buys ops burden for zero benefit. |
| **CockroachDB / Yugabyte** | No | Wrong problem | Multi-region writes we'll never need (Fact 1). |
| **Timescale / ClickHouse / Tinybird** | No | Yes | Not alternatives — the future *second* home for the snapshot warehouse (Fact 2). |

## Growth path

1. **Now**: Neon free tier; hourly sync worker via GitHub Actions.
2. **More cities**: same database, more rows. Add monthly partitioning on
   `event_snapshots` past ~50–100M rows. Neon paid tier: low hundreds
   $/month even at dozens of cities.
3. **Analytics product matures**: snapshot/search history graduates to
   ClickHouse (Tinybird); Postgres keeps claims/merchants. This split — not a
   vendor swap — is the national-scale architecture.
4. **Europe**: second regional cluster (EU region), separate `DATABASE_URL`
   per region; app tier is already stateless and city-sharded.
5. Boring-migration option to Aurora/AlloyDB remains open at every step.

## Neon setup runbook (the concrete next steps)

1. **Create the database** — [neon.tech](https://neon.tech), sign in with
   GitHub, create a project (name: `lastcall`), region **AWS us-west-2
   (Oregon)** — closest to SF/Sacramento sources and users.
2. **Copy the connection string** from the project dashboard (the pooled
   connection string is fine; it ends in `sslmode=require`, which
   `src/services/db.ts` auto-detects and enables TLS for).
3. **Add GitHub Actions secrets** — repo → Settings → Secrets and variables →
   Actions → New repository secret:
   - `DATABASE_URL` = the Neon connection string
   - `TICKETMASTER_API_KEY` = the Discovery API key
   - (`EVENTBRITE_API_TOKEN` later, when a merchant account is connected)
4. **Merge this branch to the default branch** — GitHub fires `schedule:`
   triggers only from the default branch; the hourly clock starts at merge.
5. **Validate immediately** (don't wait for the cron): Actions tab → "LastCall
   data sync" → Run workflow. A good run's log shows
   `db: connected, schema ensured, N event fingerprint(s) primed` and a
   `Listing ingest: … upserted` summary. Run it twice — the second run should
   record near-zero new snapshots (delta suppression).
6. **Verify data in Neon's SQL editor**:
   ```sql
   SELECT count(*) AS snapshots, count(DISTINCT event_id) AS events,
          min(sync_at) AS since FROM event_snapshots;
   SELECT source, count(*) FROM event_snapshots GROUP BY 1 ORDER BY 2 DESC;
   SELECT neighborhood, count(DISTINCT event_id) FROM event_snapshots
   WHERE neighborhood IN ('Midtown','Downtown Sacramento','Arden-Arcade')
   GROUP BY 1;
   ```
7. **Point local dogfooding at the same database** — add `DATABASE_URL` to
   the local MCP server env and claims/history are shared with the recorder.

Budget notes: the sync run takes ~1 minute; hourly ≈ 720 GitHub Actions
minutes/month (private-repo free tier is 2,000). Neon free tier covers the
storage/compute for a long time at two markets; watch the dashboard as cities
are added.

import pg from "pg";
import type { Claim, Merchant, Offer } from "../types.js";

/**
 * Postgres persistence — the durable half of the hybrid store.
 *
 * Listings remain an in-memory cache rebuilt from sources every sync; what
 * Postgres holds is the data that must survive restarts:
 *   - merchants + claims/confirmations (the money path)
 *   - event_snapshots: append-only, delta-only history of every listing's
 *     price/availability over time — the analytics moat (can't be backfilled)
 *   - search_log: structured demand exhaust from the search tool (filters
 *     and result counts only — never user identity)
 *
 * Enabled by DATABASE_URL. Single-node write-behind design: the in-memory
 * store stays the synchronous source of truth for decisions; Postgres is
 * updated asynchronously and re-hydrated on boot. Multi-instance atomic
 * claim decrements are a documented next step, not this milestone.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  category     text NOT NULL,
  neighborhood text NOT NULL,
  address      text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claims (
  id                 text PRIMARY KEY,
  offer_id           text NOT NULL,
  offer_title        text NOT NULL DEFAULT '',
  offer_source       text NOT NULL DEFAULT '',
  merchant_id        text NOT NULL DEFAULT '',
  party_size         int  NOT NULL,
  status             text NOT NULL,
  redemption_code    text NOT NULL,
  total_cents        int  NOT NULL,
  platform_fee_cents int  NOT NULL DEFAULT 0,
  hold_expires_at    timestamptz NOT NULL,
  event_starts_at    timestamptz,
  created_at         timestamptz NOT NULL,
  confirmed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claims_status_idx ON claims (status);

CREATE TABLE IF NOT EXISTS event_snapshots (
  id                 bigserial PRIMARY KEY,
  event_id           text NOT NULL,
  sync_at            timestamptz NOT NULL,
  kind               text NOT NULL,
  source             text NOT NULL,
  sources            text[] NOT NULL DEFAULT '{}',
  title              text NOT NULL,
  category           text NOT NULL,
  neighborhood       text NOT NULL,
  starts_at          timestamptz NOT NULL,
  price_cents        int NOT NULL,
  price_unknown      boolean NOT NULL,
  remaining_quantity int NOT NULL,
  total_quantity     int NOT NULL
);
CREATE INDEX IF NOT EXISTS event_snapshots_event_idx ON event_snapshots (event_id, sync_at);
CREATE INDEX IF NOT EXISTS event_snapshots_sync_idx ON event_snapshots (sync_at);

CREATE TABLE IF NOT EXISTS search_log (
  id               bigserial PRIMARY KEY,
  searched_at      timestamptz NOT NULL,
  query            text,
  category         text,
  neighborhood     text,
  party_size       int,
  max_price        numeric,
  within_hours     numeric,
  min_discount_pct int,
  claimable_only   boolean NOT NULL DEFAULT false,
  result_total     int NOT NULL,
  top_result_ids   text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS search_log_time_idx ON search_log (searched_at);
`;

export interface SnapshotRow {
  eventId: string;
  syncAt: Date;
  kind: string;
  source: string;
  sources: string[];
  title: string;
  category: string;
  neighborhood: string;
  startsAt: Date;
  priceCents: number;
  priceUnknown: boolean;
  remainingQuantity: number;
  totalQuantity: number;
}

export interface SearchLogEntry {
  searchedAt: Date;
  query?: string;
  category?: string;
  neighborhood?: string;
  partySize?: number;
  maxPrice?: number;
  withinHours?: number;
  minDiscountPct?: number;
  claimableOnly: boolean;
  resultTotal: number;
  topResultIds: string[];
}

export function snapshotRowFromOffer(offer: Offer, syncAt: Date): SnapshotRow {
  return {
    eventId: offer.id,
    syncAt,
    kind: offer.kind,
    source: offer.source,
    sources: offer.sources ?? [offer.source],
    title: offer.title,
    category: offer.category,
    neighborhood: offer.neighborhood,
    startsAt: offer.startsAt,
    priceCents: offer.priceCents,
    priceUnknown: offer.priceUnknown ?? false,
    remainingQuantity: offer.remainingQuantity,
    totalQuantity: offer.totalQuantity,
  };
}

export class LastcallDb {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    // Managed providers (Neon, Supabase) require TLS; local sockets don't.
    const needsSsl =
      /sslmode=require/.test(databaseUrl) || process.env.LASTCALL_PG_SSL === "on";
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 5,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async upsertMerchants(merchants: Merchant[]): Promise<void> {
    if (merchants.length === 0) return;
    const values: unknown[] = [];
    const rows = merchants.map((m, i) => {
      values.push(m.id, m.name, m.category, m.neighborhood, m.address, m.description);
      const b = i * 6;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
    });
    await this.pool.query(
      `INSERT INTO merchants (id, name, category, neighborhood, address, description)
       VALUES ${rows.join(",")}
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, category = EXCLUDED.category,
         neighborhood = EXCLUDED.neighborhood, address = EXCLUDED.address,
         description = EXCLUDED.description, updated_at = now()`,
      values,
    );
  }

  async saveClaim(claim: Claim, offer: Offer | undefined, platformFeeCents: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO claims (id, offer_id, offer_title, offer_source, merchant_id, party_size,
                           status, redemption_code, total_cents, platform_fee_cents,
                           hold_expires_at, event_starts_at, created_at, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, confirmed_at = EXCLUDED.confirmed_at,
         platform_fee_cents = EXCLUDED.platform_fee_cents, updated_at = now()`,
      [
        claim.id,
        claim.offerId,
        offer?.title ?? "",
        offer?.source ?? "",
        offer?.merchantId ?? "",
        claim.partySize,
        claim.status,
        claim.redemptionCode,
        claim.totalCents,
        platformFeeCents,
        claim.holdExpiresAt,
        offer?.startsAt ?? null,
        claim.createdAt,
        claim.confirmedAt ?? null,
      ],
    );
  }

  /** Claims worth restoring on boot: active holds and future confirmations. */
  async loadOpenClaims(now: Date): Promise<
    Array<{ claim: Claim; offerId: string }>
  > {
    const result = await this.pool.query(
      `SELECT id, offer_id, party_size, status, redemption_code, total_cents,
              hold_expires_at, created_at, confirmed_at
       FROM claims
       WHERE (status = 'held' AND hold_expires_at > $1)
          OR (status = 'confirmed' AND (event_starts_at IS NULL OR event_starts_at > $1))`,
      [now],
    );
    return result.rows.map((row) => ({
      offerId: row.offer_id as string,
      claim: {
        id: row.id as string,
        offerId: row.offer_id as string,
        partySize: row.party_size as number,
        status: row.status as Claim["status"],
        redemptionCode: row.redemption_code as string,
        totalCents: row.total_cents as number,
        holdExpiresAt: new Date(row.hold_expires_at as string),
        createdAt: new Date(row.created_at as string),
        confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string) : undefined,
      },
    }));
  }

  async insertSnapshots(rows: SnapshotRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const tuples = rows.map((r, i) => {
      values.push(
        r.eventId, r.syncAt, r.kind, r.source, r.sources, r.title, r.category,
        r.neighborhood, r.startsAt, r.priceCents, r.priceUnknown,
        r.remainingQuantity, r.totalQuantity,
      );
      const b = i * 13;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
    });
    await this.pool.query(
      `INSERT INTO event_snapshots (event_id, sync_at, kind, source, sources, title, category,
                                    neighborhood, starts_at, price_cents, price_unknown,
                                    remaining_quantity, total_quantity)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }

  async insertSearchLog(entry: SearchLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_log (searched_at, query, category, neighborhood, party_size,
                               max_price, within_hours, min_discount_pct, claimable_only,
                               result_total, top_result_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        entry.searchedAt,
        entry.query ?? null,
        entry.category ?? null,
        entry.neighborhood ?? null,
        entry.partySize ?? null,
        entry.maxPrice ?? null,
        entry.withinHours ?? null,
        entry.minDiscountPct ?? null,
        entry.claimableOnly,
        entry.resultTotal,
        entry.topResultIds,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

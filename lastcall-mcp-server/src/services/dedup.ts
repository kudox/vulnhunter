import type { Offer } from "../types.js";

/**
 * Dedup/merge engine for multi-source event ingestion.
 *
 * The same show arrives from the venue's website, Ticketmaster, an
 * aggregator, and a newsletter. Two records are considered the same event
 * when they start within a time window AND their venue names are similar
 * AND their titles are similar (token overlap — no external fuzzy-match
 * dependency needed at this scale).
 *
 * Winner selection uses source precedence: ticketing APIs beat venue sites
 * beat aggregators beat LLM-extracted text. Losers aren't discarded
 * silently — their sources are recorded on the winner (`sources`), because
 * multi-source corroboration is a quality signal worth ranking on later.
 */

/** Higher = more authoritative. Unknown sources rank at 0 (extracted-text tier). */
const SOURCE_PRECEDENCE: Record<string, number> = {
  seed: 100, // curated demo data / manually entered
  eventbrite: 90, // ticketing APIs: authoritative price + availability
  ticketmaster: 90,
  jsonld: 70, // the venue's own website
  ics: 60, // published calendar feeds
  luma: 50, // aggregators
  dothebay: 50,
  "19hz": 50,
  funcheap: 50,
  newsletter: 10, // LLM-extracted editorial text
  news: 10,
};

export function sourcePrecedence(source: string): number {
  // "jsonld:sfjazz.org"-style sources match on their prefix.
  const base = source.split(":")[0];
  return SOURCE_PRECEDENCE[base] ?? 0;
}

const TITLE_STOPWORDS = new Set([
  "the", "a", "an", "at", "in", "on", "of", "and", "with", "for", "to",
  "presents", "present", "live", "tickets", "show", "night", "featuring", "feat",
  "sf", "san", "francisco",
]);

/** Lowercase, strip punctuation/diacritics, drop stopwords and short tokens. */
export function normalizeTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !TITLE_STOPWORDS.has(t));
  return new Set(tokens);
}

export function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  // Overlap over the smaller set: a short title fully contained in a longer
  // one ("Mara Vance Trio" vs "Mara Vance Trio — Late Set") should match.
  return overlap / Math.min(a.size, b.size);
}

const START_WINDOW_MS = 45 * 60_000;
const TITLE_THRESHOLD = 0.5;
const VENUE_THRESHOLD = 0.5;

/** An offer/listing plus the venue name used for matching. */
export interface DedupRecord {
  offer: Offer;
  venueName: string;
}

interface PreparedRecord extends DedupRecord {
  titleTokens: Set<string>;
  venueTokens: Set<string>;
}

function prepare(record: DedupRecord): PreparedRecord {
  return {
    ...record,
    titleTokens: normalizeTokens(record.offer.title),
    venueTokens: normalizeTokens(record.venueName),
  };
}

function isSameEvent(a: PreparedRecord, b: PreparedRecord): boolean {
  const timeDelta = Math.abs(a.offer.startsAt.getTime() - b.offer.startsAt.getTime());
  if (timeDelta > START_WINDOW_MS) return false;

  // If both records name a venue, they must agree; a record with no venue
  // (some newsletters) can still match on time + title.
  if (a.venueTokens.size > 0 && b.venueTokens.size > 0) {
    if (tokenSimilarity(a.venueTokens, b.venueTokens) < VENUE_THRESHOLD) return false;
  }
  return tokenSimilarity(a.titleTokens, b.titleTokens) >= TITLE_THRESHOLD;
}

export interface DedupResult {
  /** Surviving records, each annotated with every source that corroborated it. */
  kept: Offer[];
  /** What was merged away, for sync logging. */
  merged: Array<{ droppedId: string; droppedSource: string; intoId: string }>;
}

/**
 * Deduplicate incoming records against existing store contents (anchors) and
 * against each other.
 *
 * - An incoming record matching an anchor is dropped (the anchor — often a
 *   claimable offer — wins regardless of precedence: never replace a
 *   claimable offer with a listing), but its source is recorded on nothing;
 *   the match is only logged. Anchor enrichment can come later.
 * - Incoming records matching each other are merged: highest source
 *   precedence wins, all sources retained on the winner.
 */
export function dedupeIncoming(
  incoming: DedupRecord[],
  anchors: DedupRecord[],
): DedupResult {
  const preparedAnchors = anchors.map(prepare);
  const merged: DedupResult["merged"] = [];
  const clusters: PreparedRecord[][] = [];

  for (const record of incoming.map(prepare)) {
    const anchor = preparedAnchors.find((a) => isSameEvent(a, record));
    if (anchor) {
      merged.push({
        droppedId: record.offer.id,
        droppedSource: record.offer.source,
        intoId: anchor.offer.id,
      });
      continue;
    }
    const cluster = clusters.find((c) => c.some((member) => isSameEvent(member, record)));
    if (cluster) {
      cluster.push(record);
    } else {
      clusters.push([record]);
    }
  }

  const kept = clusters.map((cluster) => {
    const winner = cluster.reduce((best, candidate) =>
      sourcePrecedence(candidate.offer.source) > sourcePrecedence(best.offer.source)
        ? candidate
        : best,
    );
    const sources = [...new Set(cluster.flatMap((r) => r.offer.sources ?? [r.offer.source]))];
    for (const member of cluster) {
      if (member !== winner) {
        merged.push({
          droppedId: member.offer.id,
          droppedSource: member.offer.source,
          intoId: winner.offer.id,
        });
      }
    }
    return { ...winner.offer, sources };
  });

  return { kept, merged };
}

import { parseEventDate } from "./dates.js";

/**
 * Minimal, dependency-free iCalendar (RFC 5545) parsing — just enough for
 * public event feeds: VEVENT extraction, line unfolding, TZID-aware datetime
 * parsing, text unescaping, and limited RRULE expansion (DAILY/WEEKLY, the
 * overwhelming majority of recurring civic events). Anything fancier is
 * skipped with a reason rather than mis-parsed.
 */

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

export type IcsEvent = IcsProperty[];

/** RFC 5545 line unfolding: CRLF followed by space/tab continues the line. */
export function unfoldIcs(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

/** Unescape TEXT values: \\n, \\, \\; \\\\ . */
export function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseLine(line: string): IcsProperty | undefined {
  // NAME;PARAM=value;PARAM2="quoted:value":property value
  let colonIdx = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx < 0) return undefined;

  const [name, ...paramParts] = line.slice(0, colonIdx).split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colonIdx + 1) };
}

/** Extract VEVENT blocks as property lists. */
export function parseIcsEvents(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: IcsEvent | undefined;
  for (const rawLine of unfoldIcs(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      current = [];
    } else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = undefined;
    } else if (current) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }
  return events;
}

export function prop(event: IcsEvent, name: string): IcsProperty | undefined {
  return event.find((p) => p.name === name);
}

export function propAll(event: IcsEvent, name: string): IcsProperty[] {
  return event.filter((p) => p.name === name);
}

/** "20260801T190000" -> "2026-08-01T19:00:00" (Z suffix preserved). */
function icsDateTimeToIso(value: string): string {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return value.trim();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}`;
}

export function isDateOnly(property: IcsProperty): boolean {
  return property.params.VALUE === "DATE" || /^\d{8}$/.test(property.value.trim());
}

/**
 * Parse an ICS date-time property to an instant. TZID param wins; a Z suffix
 * means UTC; otherwise the value floats in `defaultTimezone`.
 */
export function parseIcsDateTime(
  property: IcsProperty,
  defaultTimezone: string,
): Date | undefined {
  if (isDateOnly(property)) return undefined;
  const iso = icsDateTimeToIso(property.value);
  const timezone = property.params.TZID ?? defaultTimezone;
  return parseEventDate(iso, timezone);
}

/** Parse a DURATION value like PT2H30M / P1D to milliseconds. */
export function parseIcsDuration(value: string): number | undefined {
  const m = value
    .trim()
    .match(/^([+-])?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return undefined;
  const sign = m[1] === "-" ? -1 : 1;
  const [, , d, h, min, s] = m;
  const ms =
    (Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(min ?? 0) * 60 + Number(s ?? 0)) *
    1000;
  return sign * ms;
}

// --- RRULE (limited) ---

const BYDAY_TO_WEEKDAY: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

export interface ParsedRRule {
  freq: "DAILY" | "WEEKLY";
  interval: number;
  count?: number;
  until?: Date;
  /** JS weekday numbers (0=Sunday). */
  byday?: number[];
}

/** Parse RRULEs we can expand; return an error string for those we can't. */
export function parseRRule(
  value: string,
  defaultTimezone: string,
): ParsedRRule | { unsupported: string } {
  const parts: Record<string, string> = {};
  for (const piece of value.split(";")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1);
  }
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY") {
    return { unsupported: `RRULE FREQ=${freq ?? "?"} not supported` };
  }
  let byday: number[] | undefined;
  if (parts.BYDAY) {
    byday = [];
    for (const token of parts.BYDAY.split(",")) {
      if (/^[+-]?\d/.test(token)) return { unsupported: "RRULE ordinal BYDAY not supported" };
      const weekday = BYDAY_TO_WEEKDAY[token.trim().toUpperCase()];
      if (weekday === undefined) return { unsupported: `RRULE BYDAY=${token} not recognized` };
      byday.push(weekday);
    }
  }
  let until: Date | undefined;
  if (parts.UNTIL) {
    until = /T/.test(parts.UNTIL)
      ? parseEventDate(icsDateTimeToIso(parts.UNTIL), defaultTimezone)
      : parseEventDate(`${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}T23:59:59`, defaultTimezone);
  }
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? "1") || 1),
    count: parts.COUNT ? Number(parts.COUNT) : undefined,
    until,
    byday,
  };
}

const DAY_MS = 86_400_000;
const MAX_SCAN_DAYS = 366;

/**
 * Expand a DAILY/WEEKLY rule into occurrence instants from the first
 * occurrence (dtstart) through `horizonEnd`, honoring INTERVAL, COUNT,
 * UNTIL, and EXDATEs. Occurrences keep dtstart's wall-clock time via
 * day-stepping on the UTC instant (DST drift of an hour is acceptable here).
 * Week grouping for INTERVAL>1 approximates weeks as 7-day blocks from
 * dtstart rather than WKST calendar weeks.
 */
export function expandRRule(
  dtstart: Date,
  rule: ParsedRRule,
  horizonEnd: Date,
  exdates: Set<number>,
): Date[] {
  const startWeekday = dtstart.getUTCDay();
  const byday = rule.freq === "WEEKLY" ? (rule.byday ?? [startWeekday]) : undefined;
  const occurrences: Date[] = [];
  let generated = 0;

  for (let dayOffset = 0; dayOffset < MAX_SCAN_DAYS; dayOffset++) {
    const candidate = new Date(dtstart.getTime() + dayOffset * DAY_MS);
    if (rule.until && candidate.getTime() > rule.until.getTime()) break;

    let matches: boolean;
    if (rule.freq === "DAILY") {
      matches = dayOffset % rule.interval === 0;
    } else {
      const inActiveWeek = Math.floor(dayOffset / 7) % rule.interval === 0;
      matches = inActiveWeek && byday!.includes(candidate.getUTCDay());
    }
    if (!matches) continue;

    generated++;
    if (rule.count && generated > rule.count) break;
    if (!exdates.has(candidate.getTime())) occurrences.push(candidate);
    if (candidate.getTime() > horizonEnd.getTime()) break;
  }
  return occurrences.filter((o) => o.getTime() <= horizonEnd.getTime());
}

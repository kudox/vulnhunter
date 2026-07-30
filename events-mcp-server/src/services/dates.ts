/**
 * Parse an ISO-ish datetime that may lack a UTC offset. Naive values
 * ("2026-07-31T20:00:00") are interpreted in the given IANA timezone —
 * real-world feeds (venue JSON-LD, ICS with TZID) publish wall-clock times.
 */
export function parseEventDate(value: string, timezone: string): Date | undefined {
  if (!value.includes("T")) return undefined;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  const parsed = new Date(hasOffset ? value : `${value.trim()}Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (hasOffset) return parsed;

  // Naive: `parsed` treats the wall-clock as UTC. Compute the timezone's
  // offset at that instant and shift. (Off by at most an hour right at a DST
  // transition — acceptable for event data.)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(parsed).map((p) => [p.type, p.value]));
  const tzWallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = tzWallClockAsUtc - parsed.getTime();
  return new Date(parsed.getTime() - offsetMs);
}

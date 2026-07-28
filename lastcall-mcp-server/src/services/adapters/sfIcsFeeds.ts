import type { Category } from "../../types.js";

/**
 * Curated ICS/iCal feed list for SF community and civic events — the
 * free-event layer. Like the venue list, this is config-not-code: adding a
 * feed is adding a URL, and live syncs log per-feed yield so dead or moved
 * feeds can be pruned.
 *
 * `assumeFree: true` marks community calendars whose events are free unless
 * stated otherwise (ICS has no price field); other feeds get priceUnknown.
 */
export interface IcsFeed {
  url: string;
  name: string;
  neighborhood?: string;
  category?: Category;
  assumeFree?: boolean;
  /** Timezone for floating datetimes in this feed (default America/Los_Angeles). */
  timezone?: string;
}

// All feeds below verified live 2026-07-28 (HTTP 200, valid iCalendar).
// Meetup group iCal endpoints (meetup.com/<group>/events/ical/) remained
// public after the 2025 API lockdown. Yields fluctuate with group activity.
export const SF_ICS_FEEDS: IcsFeed[] = [
  {
    url: "https://www.meetup.com/sfcivictech/events/ical/",
    name: "SF Civic Tech",
    category: "art_culture",
    assumeFree: true,
  },
  {
    url: "https://www.meetup.com/sfpython/events/ical/",
    name: "SF Python",
    category: "art_culture",
    assumeFree: true,
  },
  {
    url: "https://www.meetup.com/sfruby/events/ical/",
    name: "SF Ruby",
    category: "art_culture",
    assumeFree: true,
  },
  {
    url: "https://www.meetup.com/sfnode/events/ical/",
    name: "SF Node",
    category: "art_culture",
    assumeFree: true,
  },
];

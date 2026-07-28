import type { Category } from "../../types.js";

/**
 * Curated seed list for the JSON-LD venue crawler: SF venue event/calendar
 * pages. Adding a venue is adding a URL — the crawler discovers whatever
 * schema.org Event data the page embeds. Yield varies by venue platform;
 * zero-yield venues are logged per sync so the list can be pruned/annotated.
 *
 * `neighborhood`/`category` are fallbacks used when the page's structured
 * data doesn't carry an address/type we can map.
 */
export interface VenuePage {
  url: string;
  name: string;
  neighborhood?: string;
  category?: Category;
}

export const SF_VENUE_PAGES: VenuePage[] = [
  { url: "https://www.thefillmore.com/", name: "The Fillmore", category: "live_music" },
  { url: "https://www.theindependentsf.com/", name: "The Independent", category: "live_music" },
  { url: "https://gamh.com/", name: "Great American Music Hall", category: "live_music" },
  { url: "https://thechapelsf.com/", name: "The Chapel", neighborhood: "Mission", category: "live_music" },
  { url: "https://rickshawstop.com/", name: "Rickshaw Stop", neighborhood: "Hayes Valley", category: "live_music" },
  { url: "https://www.dnalounge.com/", name: "DNA Lounge", neighborhood: "SoMa", category: "live_music" },
  { url: "https://cafedunord.com/", name: "Cafe du Nord", neighborhood: "Castro", category: "live_music" },
  { url: "https://www.thewarfieldtheatre.com/", name: "The Warfield", category: "live_music" },
  { url: "https://bimbos365club.com/", name: "Bimbo's 365 Club", neighborhood: "North Beach", category: "live_music" },
  { url: "https://www.sfjazz.org/", name: "SFJAZZ Center", neighborhood: "Hayes Valley", category: "live_music" },
  { url: "https://www.bottomofthehill.com/calendar.html", name: "Bottom of the Hill", neighborhood: "Dogpatch", category: "live_music" },
  { url: "https://augusthallsf.com/", name: "August Hall", category: "live_music" },
  { url: "https://themidwaysf.com/", name: "The Midway", neighborhood: "Dogpatch", category: "live_music" },
  { url: "https://publicsf.com/", name: "Public Works", neighborhood: "Mission", category: "live_music" },
  { url: "https://www.cobbscomedy.com/", name: "Cobb's Comedy Club", neighborhood: "North Beach", category: "comedy" },
  { url: "https://roxie.com/calendar/", name: "Roxie Theater", neighborhood: "Mission", category: "art_culture" },
  { url: "https://www.sfmoma.org/events/", name: "SFMOMA", neighborhood: "SoMa", category: "art_culture" },
  { url: "https://www.famsf.org/calendar", name: "de Young Museum", category: "art_culture" },
  { url: "https://www.exploratorium.edu/visit/calendar", name: "Exploratorium", category: "art_culture" },
  { url: "https://grayarea.org/events/", name: "Gray Area", neighborhood: "Mission", category: "art_culture" },
  { url: "https://www.commonwealthclub.org/events", name: "Commonwealth Club", category: "art_culture" },
  { url: "https://www.cityarts.net/", name: "City Arts & Lectures", neighborhood: "Hayes Valley", category: "art_culture" },
  { url: "https://www.sterngrove.org/", name: "Stern Grove Festival", neighborhood: "Outer Sunset", category: "live_music" },
];

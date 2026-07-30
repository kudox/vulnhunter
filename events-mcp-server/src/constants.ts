export const SERVER_NAME = "events-mcp-server";
export const SERVER_VERSION = "0.1.0";

export const CITY = "San Francisco & Sacramento";

/** Maximum response size in characters before truncation kicks in. */
export const CHARACTER_LIMIT = 25000;

/** How long a claim holds inventory before it expires and seats are released. */
export const HOLD_DURATION_MINUTES = 10;

/** Platform take rate applied at confirmation, in percent of transaction value. */
export const PLATFORM_FEE_PCT = 12;

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

export const NEIGHBORHOODS = [
  // San Francisco
  "Mission",
  "SoMa",
  "Hayes Valley",
  "North Beach",
  "Marina",
  "Castro",
  "Dogpatch",
  "Richmond",
  "Outer Sunset",
  "Financial District",
  // Sacramento
  "Midtown",
  "Downtown Sacramento",
  "East Sacramento",
  "Land Park",
  "Oak Park",
  "Tahoe Park",
  "Natomas",
  "Arden-Arcade",
] as const;

export const CATEGORIES = [
  "live_music",
  "comedy",
  "theater",
  "food_drink",
  "fitness",
  "wellness",
  "art_culture",
  "sports",
] as const;

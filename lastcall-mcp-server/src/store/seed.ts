import type { Merchant, Offer } from "../types.js";

/**
 * Demo seed data: fictional San Francisco merchants and offers.
 *
 * Offer times are generated relative to `now` so a fresh server always has
 * inventory "tonight", "tomorrow", and "this weekend" — the scenarios the
 * product exists for. In production this data comes from merchant inventory
 * feeds (Eventbrite, Square, Toast, Mindbody) filtered through per-merchant
 * promotion rules.
 */

const MERCHANTS: Merchant[] = [
  {
    id: "mer_velvet_owl",
    name: "The Velvet Owl",
    category: "live_music",
    neighborhood: "North Beach",
    address: "1287 Grant Ave",
    description:
      "Intimate 80-seat jazz room with a rotating cast of Bay Area trios and touring headliners.",
  },
  {
    id: "mer_fogline",
    name: "Fogline Comedy Club",
    category: "comedy",
    neighborhood: "SoMa",
    address: "540 Folsom St",
    description:
      "Stand-up club with nightly showcases; industry night on Wednesdays draws surprise drop-ins.",
  },
  {
    id: "mer_cielo_rojo",
    name: "Cielo Rojo Cantina",
    category: "food_drink",
    neighborhood: "Mission",
    address: "2214 Valencia St",
    description:
      "Oaxacan-inspired cantina known for mole flights and an early-evening lull it would love to fill.",
  },
  {
    id: "mer_corkline",
    name: "Corkline Wine Bar",
    category: "food_drink",
    neighborhood: "Hayes Valley",
    address: "398 Hayes St",
    description:
      "Natural wine bar with weekly guided tastings and a quiet Tuesday problem.",
  },
  {
    id: "mer_fogbreak",
    name: "Fogbreak Oyster Shed",
    category: "food_drink",
    neighborhood: "Financial District",
    address: "12 Steuart St",
    description:
      "Waterfront oyster bar; shucks far more than it sells between 4 and 6pm on weekdays.",
  },
  {
    id: "mer_bayline",
    name: "Bayline Supper Club",
    category: "live_music",
    neighborhood: "Marina",
    address: "3301 Fillmore St",
    description:
      "Dinner-and-a-band supper club; late second seatings often go out half empty.",
  },
  {
    id: "mer_marquee_main",
    name: "Marquee & Main Theater",
    category: "theater",
    neighborhood: "Castro",
    address: "455 Castro St",
    description:
      "120-seat black-box theater staging new works; weekend matinees rarely sell through.",
  },
  {
    id: "mer_dogpatch_boulder",
    name: "Dogpatch Boulder Co.",
    category: "fitness",
    neighborhood: "Dogpatch",
    address: "880 Tennessee St",
    description:
      "Bouldering gym with yoga studio; midweek daytime capacity sits mostly idle.",
  },
  {
    id: "mer_loft_lotus",
    name: "Loft & Lotus Yoga",
    category: "wellness",
    neighborhood: "Hayes Valley",
    address: "77 Linden St",
    description:
      "Boutique yoga loft; early-morning and mid-afternoon classes run below half full.",
  },
  {
    id: "mer_sunset_sauna",
    name: "Outer Sunset Sauna Co.",
    category: "wellness",
    neighborhood: "Outer Sunset",
    address: "3618 Taraval St",
    description:
      "Ocean-adjacent sauna and cold-plunge studio; off-peak weekday slots are its perishable inventory.",
  },
  {
    id: "mer_prism_alley",
    name: "Prism Alley Gallery",
    category: "art_culture",
    neighborhood: "Dogpatch",
    address: "2450 3rd St",
    description:
      "Contemporary gallery running ticketed evening exhibitions and artist talks.",
  },
  {
    id: "mer_salt_salsa",
    name: "Salt & Salsa Studio",
    category: "art_culture",
    neighborhood: "Mission",
    address: "3160 16th St",
    description:
      "Latin dance studio; beginner salsa socials need a critical mass of newcomers to work.",
  },
];

interface SeedOfferSpec {
  id: string;
  merchantId: string;
  title: string;
  description: string;
  /** Hours from now until the experience starts. */
  startsInHours: number;
  durationHours: number;
  /** Hours before start when claiming closes. */
  claimCutoffHours: number;
  priceCents: number;
  faceValueCents: number;
  totalQuantity: number;
  minPartySize?: number;
  maxPartySize?: number;
  newCustomersOnly?: boolean;
  sponsored?: boolean;
  terms: string;
}

const OFFER_SPECS: SeedOfferSpec[] = [
  {
    id: "off_velvet_late_set",
    merchantId: "mer_velvet_owl",
    title: "Late Set: Mara Vance Trio — 40% off",
    description:
      "Second set of the night. Same band, same room, half the crowd. Two-drink minimum still applies.",
    startsInHours: 5,
    durationHours: 1.5,
    claimCutoffHours: 1,
    priceCents: 2100,
    faceValueCents: 3500,
    totalQuantity: 24,
    maxPartySize: 6,
    terms: "Valid only for the late set. Two-drink minimum per person. No refunds after confirmation.",
  },
  {
    id: "off_velvet_weekend_headliner",
    merchantId: "mer_velvet_owl",
    title: "Saturday Headliner: Balcony Seats — 25% off",
    description:
      "Balcony pairs released for Saturday's touring headliner. Sightlines are great; the floor just sold first.",
    startsInHours: 52,
    durationHours: 2,
    claimCutoffHours: 3,
    priceCents: 4500,
    faceValueCents: 6000,
    totalQuantity: 12,
    maxPartySize: 4,
    sponsored: true,
    terms: "Balcony seating only. Doors 30 minutes before showtime.",
  },
  {
    id: "off_fogline_tonight",
    merchantId: "mer_fogline",
    title: "Tonight's Showcase — fill-the-room $12 seats",
    description:
      "Eight comics, one hour, and a room that plays better full. Tonight's showcase at a third of face value.",
    startsInHours: 4,
    durationHours: 1.5,
    claimCutoffHours: 0.5,
    priceCents: 1200,
    faceValueCents: 3000,
    totalQuantity: 30,
    maxPartySize: 8,
    terms: "General admission. Seating first-come. One item minimum from the bar menu.",
  },
  {
    id: "off_fogline_industry_night",
    merchantId: "mer_fogline",
    title: "Industry Night Wednesday — 2-for-1 tickets",
    description:
      "Midweek showcase with occasional unannounced drop-ins from touring headliners. Priced to fill.",
    startsInHours: 28,
    durationHours: 2,
    claimCutoffHours: 2,
    priceCents: 1500,
    faceValueCents: 3000,
    totalQuantity: 20,
    minPartySize: 2,
    maxPartySize: 6,
    terms: "Price shown is per person and reflects the 2-for-1 promotion. 18+.",
  },
  {
    id: "off_cielo_early_eve",
    merchantId: "mer_cielo_rojo",
    title: "5–6:30pm Mole Flight Dinner — 35% off",
    description:
      "Three-course mole tasting for the early seating the kitchen is otherwise staring at an empty room for.",
    startsInHours: 3,
    durationHours: 1.5,
    claimCutoffHours: 1,
    priceCents: 3900,
    faceValueCents: 6000,
    totalQuantity: 16,
    minPartySize: 2,
    maxPartySize: 6,
    terms: "Party must be seated by 5:30pm. Beverages not included.",
  },
  {
    id: "off_corkline_tasting",
    merchantId: "mer_corkline",
    title: "Tuesday Natural Wine Tasting — half price",
    description:
      "Guided six-pour tasting with the buyer. Tuesdays are quiet; the bottles are already open.",
    startsInHours: 26,
    durationHours: 1.5,
    claimCutoffHours: 4,
    priceCents: 2500,
    faceValueCents: 5000,
    totalQuantity: 10,
    newCustomersOnly: true,
    terms: "First-time guests only. 21+. Six one-ounce pours included.",
  },
  {
    id: "off_fogbreak_happy_hour",
    merchantId: "mer_fogbreak",
    title: "4–6pm Oyster Happy Hour — $1.50 oysters",
    description:
      "Weekday pre-rush window: dozen-minimum oysters at $1.50 each, shucked to order at the rail.",
    startsInHours: 2,
    durationHours: 2,
    claimCutoffHours: 0.5,
    priceCents: 1800,
    faceValueCents: 3600,
    totalQuantity: 40,
    maxPartySize: 8,
    sponsored: true,
    terms: "Price shown covers a dozen oysters per person. Rail and patio seating only.",
  },
  {
    id: "off_bayline_second_seating",
    merchantId: "mer_bayline",
    title: "9pm Second Seating: Dinner + Band — 30% off",
    description:
      "Full supper-club experience at the late seating. The band's warmed up and the room has space.",
    startsInHours: 7,
    durationHours: 2.5,
    claimCutoffHours: 2,
    priceCents: 6300,
    faceValueCents: 9000,
    totalQuantity: 18,
    minPartySize: 2,
    maxPartySize: 8,
    terms: "Three-course set menu included. Gratuity and drinks separate.",
  },
  {
    id: "off_marquee_matinee",
    merchantId: "mer_marquee_main",
    title: "Sunday Matinee: 'Glass Harbor' — 45% off",
    description:
      "New-work drama in its final weekend. Matinee house is a third sold; cast deserves better.",
    startsInHours: 70,
    durationHours: 2,
    claimCutoffHours: 6,
    priceCents: 2200,
    faceValueCents: 4000,
    totalQuantity: 35,
    maxPartySize: 6,
    terms: "Open seating. Doors 20 minutes before curtain. No late seating after Act 1 begins.",
  },
  {
    id: "off_dogpatch_midweek",
    merchantId: "mer_dogpatch_boulder",
    title: "Midweek Day Pass + Rental — 50% off before 4pm",
    description:
      "Full gym access plus shoe rental during the dead midweek daytime window.",
    startsInHours: 20,
    durationHours: 6,
    claimCutoffHours: 1,
    priceCents: 1600,
    faceValueCents: 3200,
    totalQuantity: 25,
    maxPartySize: 4,
    terms: "Valid for entry before 4pm on the stated day. Includes shoe rental. First visit requires waiver.",
  },
  {
    id: "off_loft_lotus_sunrise",
    merchantId: "mer_loft_lotus",
    title: "Sunrise Flow Tomorrow — $8 mat spots",
    description:
      "6:45am vinyasa with mats to spare. Cheaper than your latte, and the instructor is excellent.",
    startsInHours: 18,
    durationHours: 1,
    claimCutoffHours: 1,
    priceCents: 800,
    faceValueCents: 2400,
    totalQuantity: 14,
    maxPartySize: 2,
    terms: "Mats and props provided. Arrive 10 minutes early; doors lock at start.",
  },
  {
    id: "off_sunset_sauna_offpeak",
    merchantId: "mer_sunset_sauna",
    title: "Weekday Afternoon Sauna + Plunge — 40% off",
    description:
      "75-minute sauna and cold-plunge session in the quiet afternoon window, three blocks from Ocean Beach.",
    startsInHours: 23,
    durationHours: 1.25,
    claimCutoffHours: 2,
    priceCents: 2700,
    faceValueCents: 4500,
    totalQuantity: 8,
    maxPartySize: 4,
    newCustomersOnly: true,
    terms: "First-time guests only. Towels included. Swimsuits required in communal areas.",
  },
  {
    id: "off_prism_opening",
    merchantId: "mer_prism_alley",
    title: "Thursday Opening: 'Signal Decay' + Artist Talk — 2-for-1",
    description:
      "Ticketed opening night with artist talk. The work is strong; the RSVP list is short.",
    startsInHours: 30,
    durationHours: 3,
    claimCutoffHours: 3,
    priceCents: 1000,
    faceValueCents: 2000,
    totalQuantity: 40,
    minPartySize: 2,
    maxPartySize: 6,
    terms: "Price shown is per person under the 2-for-1 promotion. Includes one pour of wine.",
  },
  {
    id: "off_salt_salsa_social",
    merchantId: "mer_salt_salsa",
    title: "Friday Beginner Salsa Social — 60% off first visit",
    description:
      "Hour lesson then open social. The floor works best crowded, so first-timers get in nearly free.",
    startsInHours: 44,
    durationHours: 3,
    claimCutoffHours: 2,
    priceCents: 1000,
    faceValueCents: 2500,
    totalQuantity: 30,
    maxPartySize: 10,
    newCustomersOnly: true,
    terms: "First visit only. No partner or experience needed. Shoes with smooth soles recommended.",
  },
  {
    id: "off_cielo_taco_tuesday",
    merchantId: "mer_cielo_rojo",
    title: "Late-Night Taco Window — kitchen clear-out, 50% off",
    description:
      "Last 90 minutes of service tonight: the kitchen would rather sell the day's masa than compost it.",
    startsInHours: 8,
    durationHours: 1.5,
    claimCutoffHours: 0.5,
    priceCents: 1400,
    faceValueCents: 2800,
    totalQuantity: 20,
    maxPartySize: 6,
    terms: "Limited late-night menu. Bar seating and standing room only.",
  },
  {
    id: "off_marquee_preview",
    merchantId: "mer_marquee_main",
    title: "Tomorrow's Preview Performance — pay-what-you-can from $15",
    description:
      "Preview night before official opening. Full production, working-out-the-kinks price.",
    startsInHours: 27,
    durationHours: 2,
    claimCutoffHours: 3,
    priceCents: 1500,
    faceValueCents: 4000,
    totalQuantity: 45,
    maxPartySize: 8,
    sponsored: true,
    terms: "Preview performance; minor technical pauses possible. Open seating.",
  },
];

export interface SeedData {
  merchants: Merchant[];
  offers: Offer[];
}

export function buildSeed(now: Date): SeedData {
  const hours = (h: number): Date => new Date(now.getTime() + h * 3_600_000);

  const merchantsById = new Map(MERCHANTS.map((m) => [m.id, m]));

  const offers: Offer[] = OFFER_SPECS.map((spec) => {
    const merchant = merchantsById.get(spec.merchantId);
    if (!merchant) {
      throw new Error(`Seed offer ${spec.id} references unknown merchant ${spec.merchantId}`);
    }
    return {
      id: spec.id,
      merchantId: spec.merchantId,
      title: spec.title,
      description: spec.description,
      category: merchant.category,
      neighborhood: merchant.neighborhood,
      startsAt: hours(spec.startsInHours),
      endsAt: hours(spec.startsInHours + spec.durationHours),
      claimDeadline: hours(spec.startsInHours - spec.claimCutoffHours),
      priceCents: spec.priceCents,
      faceValueCents: spec.faceValueCents,
      totalQuantity: spec.totalQuantity,
      remainingQuantity: spec.totalQuantity,
      minPartySize: spec.minPartySize ?? 1,
      maxPartySize: spec.maxPartySize ?? 8,
      newCustomersOnly: spec.newCustomersOnly ?? false,
      sponsored: spec.sponsored ?? false,
      terms: spec.terms,
    };
  });

  return { merchants: [...MERCHANTS], offers };
}

/**
 * Best-effort postal code -> neighborhood mapping for the server's markets
 * (San Francisco + Sacramento), shared by all feed adapters.
 */
const ZIP_NEIGHBORHOODS: Record<string, string> = {
  // San Francisco
  "94102": "Hayes Valley",
  "94103": "SoMa",
  "94104": "Financial District",
  "94105": "SoMa",
  "94107": "Dogpatch",
  "94110": "Mission",
  "94111": "Financial District",
  "94114": "Castro",
  "94116": "Outer Sunset",
  "94118": "Richmond",
  "94121": "Richmond",
  "94122": "Outer Sunset",
  "94123": "Marina",
  "94133": "North Beach",
  // Sacramento
  "95811": "Midtown",
  "95814": "Downtown Sacramento",
  "95816": "Midtown",
  "95817": "Oak Park",
  "95818": "Land Park",
  "95819": "East Sacramento",
  "95820": "Tahoe Park",
  "95821": "Arden-Arcade",
  "95825": "Arden-Arcade",
  "95833": "Natomas",
  "95834": "Natomas",
  "95835": "Natomas",
};

export function neighborhoodForZip(zip: string): string | undefined {
  return ZIP_NEIGHBORHOODS[zip];
}

/** @deprecated Renamed — kept for any straggling imports; remove after next cleanup. */
export const sfNeighborhoodForZip = neighborhoodForZip;

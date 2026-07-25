/** Best-effort SF postal code -> neighborhood mapping, shared by all feed adapters. */
const SF_ZIP_NEIGHBORHOODS: Record<string, string> = {
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
};

export function sfNeighborhoodForZip(zip: string): string | undefined {
  return SF_ZIP_NEIGHBORHOODS[zip];
}

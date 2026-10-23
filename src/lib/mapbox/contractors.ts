/**
 * Government contractor → HQ city coordinates lookup.
 * Maps top ~60 defense/government contractors to real HQ locations.
 */

export const CONTRACTOR_COORDS: Record<string, { lat: number; lon: number; city: string }> = {
  'lockheed martin': { lat: 38.88, lon: -77.23, city: 'Bethesda, MD' },
  raytheon: { lat: 42.31, lon: -71.26, city: 'Waltham, MA' },
  rtx: { lat: 42.31, lon: -71.26, city: 'Waltham, MA' },
  boeing: { lat: 41.88, lon: -87.64, city: 'Chicago, IL' },
  'northrop grumman': { lat: 38.95, lon: -77.47, city: 'Falls Church, VA' },
  'general dynamics': { lat: 38.86, lon: -77.06, city: 'Reston, VA' },
  l3harris: { lat: 28.28, lon: -80.72, city: 'Melbourne, FL' },
  'l3 harris': { lat: 28.28, lon: -80.72, city: 'Melbourne, FL' },
  'bae systems': { lat: 38.88, lon: -77.11, city: 'Arlington, VA' },
  leidos: { lat: 38.95, lon: -77.35, city: 'Reston, VA' },
  'booz allen hamilton': { lat: 38.92, lon: -77.23, city: 'McLean, VA' },
  'booz allen': { lat: 38.92, lon: -77.23, city: 'McLean, VA' },
  saic: { lat: 38.95, lon: -77.35, city: 'Reston, VA' },
  'huntington ingalls': { lat: 36.98, lon: -76.43, city: 'Newport News, VA' },
  'general atomics': { lat: 32.88, lon: -117.23, city: 'San Diego, CA' },
  textron: { lat: 41.82, lon: -71.41, city: 'Providence, RI' },
  'harris corporation': { lat: 28.28, lon: -80.72, city: 'Melbourne, FL' },
  perspecta: { lat: 38.86, lon: -77.44, city: 'Chantilly, VA' },
  'caci international': { lat: 38.88, lon: -77.11, city: 'Arlington, VA' },
  caci: { lat: 38.88, lon: -77.11, city: 'Arlington, VA' },
  mantech: { lat: 38.86, lon: -77.44, city: 'Chantilly, VA' },
  'science applications': { lat: 38.95, lon: -77.35, city: 'Reston, VA' },
  aecom: { lat: 34.05, lon: -118.25, city: 'Los Angeles, CA' },
  fluor: { lat: 32.9, lon: -96.77, city: 'Irving, TX' },
  honeywell: { lat: 35.2, lon: -80.84, city: 'Charlotte, NC' },
  'united technologies': { lat: 41.77, lon: -72.68, city: 'Hartford, CT' },
  'general electric': { lat: 42.36, lon: -71.06, city: 'Boston, MA' },
  'ge aerospace': { lat: 39.26, lon: -84.33, city: 'Evendale, OH' },
  'pratt & whitney': { lat: 41.69, lon: -72.73, city: 'East Hartford, CT' },
  'rolls-royce': { lat: 46.08, lon: -118.33, city: 'Indianapolis, IN' },
  kbr: { lat: 29.76, lon: -95.37, city: 'Houston, TX' },
  parsons: { lat: 38.86, lon: -77.44, city: 'Chantilly, VA' },
  'maxar technologies': { lat: 38.85, lon: -77.05, city: 'Westminster, CO' },
  palantir: { lat: 37.39, lon: -122.08, city: 'Palo Alto, CA' },
  anduril: { lat: 33.68, lon: -117.83, city: 'Costa Mesa, CA' },
  'shield ai': { lat: 32.72, lon: -117.16, city: 'San Diego, CA' },
  'elbit systems': { lat: 32.79, lon: 35.0, city: 'Haifa, Israel' },
  thales: { lat: 48.88, lon: 2.24, city: 'Courbevoie, France' },
  leonardo: { lat: 41.9, lon: 12.5, city: 'Rome, Italy' },
  saab: { lat: 58.59, lon: 16.18, city: 'Linkoping, Sweden' },
  rheinmetall: { lat: 51.23, lon: 6.77, city: 'Dusseldorf, Germany' },
  dassault: { lat: 48.81, lon: 2.29, city: 'Paris, France' },
  'airbus defense': { lat: 48.14, lon: 11.58, city: 'Munich, Germany' },
  rafael: { lat: 32.79, lon: 35.0, city: 'Haifa, Israel' },
  iai: { lat: 32.01, lon: 34.78, city: 'Lod, Israel' },
  deloitte: { lat: 38.9, lon: -77.04, city: 'Washington, DC' },
  'accenture federal': { lat: 38.88, lon: -77.11, city: 'Arlington, VA' },
  ibm: { lat: 41.11, lon: -73.72, city: 'Armonk, NY' },
  microsoft: { lat: 47.64, lon: -122.13, city: 'Redmond, WA' },
  'amazon web services': { lat: 47.62, lon: -122.34, city: 'Seattle, WA' },
  aws: { lat: 47.62, lon: -122.34, city: 'Seattle, WA' },
  oracle: { lat: 36.62, lon: -121.92, city: 'Austin, TX' },
  'dell technologies': { lat: 30.44, lon: -97.76, city: 'Round Rock, TX' },
  'hp enterprise': { lat: 29.97, lon: -95.69, city: 'Spring, TX' },
  cisco: { lat: 37.41, lon: -121.96, city: 'San Jose, CA' },
  'at&t': { lat: 32.78, lon: -96.8, city: 'Dallas, TX' },
  verizon: { lat: 40.75, lon: -73.99, city: 'New York, NY' },
  'raytheon missiles': { lat: 32.22, lon: -110.97, city: 'Tucson, AZ' },
  'lockheed martin aeronautics': { lat: 32.75, lon: -97.33, city: 'Fort Worth, TX' },
  'lockheed martin space': { lat: 39.74, lon: -104.99, city: 'Denver, CO' },
  'bath iron works': { lat: 43.91, lon: -69.82, city: 'Bath, ME' },
};

/**
 * Look up contractor HQ coordinates by name (fuzzy match).
 */
export function lookupContractorCoords(
  name: string,
): { lat: number; lon: number; city: string } | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  // Exact match first
  if (CONTRACTOR_COORDS[lower]) return CONTRACTOR_COORDS[lower]!;
  // Fuzzy: check if name contains any known contractor
  for (const [key, coords] of Object.entries(CONTRACTOR_COORDS)) {
    if (lower.includes(key) || key.includes(lower)) return coords;
  }
  return null;
}

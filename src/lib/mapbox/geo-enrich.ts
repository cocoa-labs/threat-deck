/**
 * Geo-enrichment utilities for the semantic zoom system.
 * Provides coordinate lookup tables and zoom tier assignment logic.
 */

import type { ZoomTier } from '@/lib/types';

// ─── US State Coordinates (state capital / population center) ───

export const US_STATE_COORDS: Record<string, { lat: number; lon: number }> = {
  alabama: { lat: 32.4, lon: -86.3 },
  alaska: { lat: 64.2, lon: -152.5 },
  arizona: { lat: 34.0, lon: -111.1 },
  arkansas: { lat: 35.0, lon: -92.4 },
  california: { lat: 36.8, lon: -119.4 },
  colorado: { lat: 39.0, lon: -105.5 },
  connecticut: { lat: 41.6, lon: -72.7 },
  delaware: { lat: 39.2, lon: -75.5 },
  florida: { lat: 27.8, lon: -81.8 },
  georgia: { lat: 32.2, lon: -83.6 },
  hawaii: { lat: 19.9, lon: -155.6 },
  idaho: { lat: 44.1, lon: -114.7 },
  illinois: { lat: 40.3, lon: -89.0 },
  indiana: { lat: 40.3, lon: -86.1 },
  iowa: { lat: 42.0, lon: -93.2 },
  kansas: { lat: 38.5, lon: -96.7 },
  kentucky: { lat: 37.7, lon: -84.7 },
  louisiana: { lat: 31.2, lon: -92.2 },
  maine: { lat: 45.3, lon: -69.4 },
  maryland: { lat: 39.0, lon: -76.6 },
  massachusetts: { lat: 42.4, lon: -71.4 },
  michigan: { lat: 44.2, lon: -84.5 },
  minnesota: { lat: 46.7, lon: -94.7 },
  mississippi: { lat: 32.3, lon: -89.4 },
  missouri: { lat: 38.6, lon: -91.8 },
  montana: { lat: 46.8, lon: -110.4 },
  nebraska: { lat: 41.1, lon: -98.3 },
  nevada: { lat: 38.8, lon: -116.4 },
  'new hampshire': { lat: 43.5, lon: -71.6 },
  'new jersey': { lat: 40.1, lon: -74.4 },
  'new mexico': { lat: 34.5, lon: -106.2 },
  'new york': { lat: 40.7, lon: -74.0 },
  'north carolina': { lat: 35.6, lon: -79.0 },
  'north dakota': { lat: 47.5, lon: -100.5 },
  ohio: { lat: 40.4, lon: -82.9 },
  oklahoma: { lat: 35.0, lon: -97.1 },
  oregon: { lat: 43.8, lon: -120.6 },
  pennsylvania: { lat: 41.2, lon: -77.2 },
  'rhode island': { lat: 41.6, lon: -71.5 },
  'south carolina': { lat: 33.9, lon: -81.0 },
  'south dakota': { lat: 43.9, lon: -99.9 },
  tennessee: { lat: 35.5, lon: -86.0 },
  texas: { lat: 31.0, lon: -97.5 },
  utah: { lat: 39.3, lon: -111.1 },
  vermont: { lat: 44.0, lon: -72.7 },
  virginia: { lat: 37.8, lon: -78.2 },
  washington: { lat: 47.4, lon: -120.7 },
  'west virginia': { lat: 38.6, lon: -80.6 },
  wisconsin: { lat: 44.3, lon: -89.6 },
  wyoming: { lat: 43.1, lon: -107.6 },
};

// State abbreviation lookup
const STATE_ABBREV: Record<string, string> = {
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DE: 'delaware',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  IA: 'iowa',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  ME: 'maine',
  MD: 'maryland',
  MA: 'massachusetts',
  MI: 'michigan',
  MN: 'minnesota',
  MS: 'mississippi',
  MO: 'missouri',
  MT: 'montana',
  NE: 'nebraska',
  NV: 'nevada',
  NH: 'new hampshire',
  NJ: 'new jersey',
  NM: 'new mexico',
  NY: 'new york',
  NC: 'north carolina',
  ND: 'north dakota',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhode island',
  SC: 'south carolina',
  SD: 'south dakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VT: 'vermont',
  VA: 'virginia',
  WA: 'washington',
  WV: 'west virginia',
  WI: 'wisconsin',
  WY: 'wyoming',
};

/**
 * Look up state coordinates by state name or abbreviation.
 */
export function lookupStateCoords(stateInput: string): { lat: number; lon: number } | null {
  const key = stateInput.trim();
  // Try abbreviation first
  const fullName = STATE_ABBREV[key.toUpperCase()];
  if (fullName) {
    return US_STATE_COORDS[fullName] ?? null;
  }
  // Try full name
  return US_STATE_COORDS[key.toLowerCase()] ?? null;
}

// ─── Federal Agency HQ Coordinates ───

export const AGENCY_COORDS: Record<string, { lat: number; lon: number }> = {
  'department of defense': { lat: 38.87, lon: -77.06 },
  dod: { lat: 38.87, lon: -77.06 },
  'department of homeland security': { lat: 38.88, lon: -77.01 },
  dhs: { lat: 38.88, lon: -77.01 },
  'department of energy': { lat: 38.87, lon: -77.03 },
  doe: { lat: 38.87, lon: -77.03 },
  nasa: { lat: 29.55, lon: -95.09 },
  'national aeronautics': { lat: 29.55, lon: -95.09 },
  'department of health': { lat: 38.88, lon: -77.02 },
  hhs: { lat: 38.88, lon: -77.02 },
  'department of veterans affairs': { lat: 38.89, lon: -77.03 },
  va: { lat: 38.89, lon: -77.03 },
  'department of justice': { lat: 38.89, lon: -77.02 },
  doj: { lat: 38.89, lon: -77.02 },
  'department of state': { lat: 38.89, lon: -77.05 },
  'state department': { lat: 38.89, lon: -77.05 },
  'department of treasury': { lat: 38.9, lon: -77.04 },
  treasury: { lat: 38.9, lon: -77.04 },
  'department of education': { lat: 38.88, lon: -77.02 },
  fbi: { lat: 38.89, lon: -77.02 },
  cia: { lat: 38.95, lon: -77.15 },
  nsa: { lat: 39.11, lon: -76.77 },
  usaid: { lat: 38.88, lon: -77.05 },
  army: { lat: 38.87, lon: -77.06 },
  navy: { lat: 38.87, lon: -77.06 },
  'air force': { lat: 38.87, lon: -77.06 },
  'general services': { lat: 38.9, lon: -77.04 },
  gsa: { lat: 38.9, lon: -77.04 },
  'department of transportation': { lat: 38.88, lon: -77.02 },
  dot: { lat: 38.88, lon: -77.02 },
  epa: { lat: 38.89, lon: -77.03 },
};

/**
 * Look up agency coordinates by agency name (fuzzy match).
 */
export function lookupAgencyCoords(agency: string): { lat: number; lon: number } | null {
  if (!agency) return null;
  const lower = agency.toLowerCase().trim();
  // Direct match
  if (AGENCY_COORDS[lower]) return AGENCY_COORDS[lower]!;
  // Partial match
  for (const [key, coords] of Object.entries(AGENCY_COORDS)) {
    if (lower.includes(key) || key.includes(lower)) return coords;
  }
  return null;
}

// ─── Blockchain Ecosystem Hub Coordinates ───

export const CRYPTO_HUB_COORDS: Record<string, { lat: number; lon: number }> = {
  btc: { lat: 37.8, lon: -122.4 }, // SF (major BTC ecosystem hub)
  bitcoin: { lat: 37.8, lon: -122.4 },
  eth: { lat: 47.17, lon: 8.52 }, // Zug, Switzerland (Ethereum Foundation)
  ethereum: { lat: 47.17, lon: 8.52 },
  sol: { lat: 37.8, lon: -122.4 }, // San Francisco
  solana: { lat: 37.8, lon: -122.4 },
  bnb: { lat: 1.35, lon: 103.82 }, // Singapore (Binance)
  xrp: { lat: 37.8, lon: -122.4 }, // San Francisco (Ripple)
  ripple: { lat: 37.8, lon: -122.4 },
  ada: { lat: 47.17, lon: 8.52 }, // Zug (IOHK)
  cardano: { lat: 47.17, lon: 8.52 },
  doge: { lat: 37.8, lon: -122.4 },
  avax: { lat: 40.7, lon: -74.0 }, // NYC (Ava Labs)
  avalanche: { lat: 40.7, lon: -74.0 },
  matic: { lat: 19.08, lon: 72.88 }, // Mumbai (Polygon)
  polygon: { lat: 19.08, lon: 72.88 },
  dot: { lat: 47.17, lon: 8.52 }, // Zug (Web3 Foundation)
  polkadot: { lat: 47.17, lon: 8.52 },
  usdt: { lat: 22.32, lon: 114.17 }, // Hong Kong (Tether)
  tether: { lat: 22.32, lon: 114.17 },
  usdc: { lat: 42.36, lon: -71.06 }, // Boston (Circle)
};

/**
 * Look up crypto hub coordinates by symbol or name.
 */
export function lookupCryptoHubCoords(symbolOrName: string): { lat: number; lon: number } | null {
  return CRYPTO_HUB_COORDS[symbolOrName.toLowerCase().trim()] ?? null;
}

// ─── Region Bounds (for spreading markers within regions) ───

export const REGION_BOUNDS: Record<
  string,
  { latMin: number; latMax: number; lonMin: number; lonMax: number }
> = {
  midwest: { latMin: 38.0, latMax: 45.0, lonMin: -95.0, lonMax: -83.0 },
  southeast: { latMin: 29.0, latMax: 37.0, lonMin: -92.0, lonMax: -75.0 },
  northeast: { latMin: 39.0, latMax: 45.0, lonMin: -80.0, lonMax: -69.0 },
  southwest: { latMin: 30.0, latMax: 38.0, lonMin: -118.0, lonMax: -103.0 },
  'pacific northwest': { latMin: 42.0, latMax: 49.0, lonMin: -125.0, lonMax: -117.0 },
  'great plains': { latMin: 36.0, latMax: 48.0, lonMin: -104.0, lonMax: -95.0 },
  'gulf coast': { latMin: 26.0, latMax: 31.0, lonMin: -97.0, lonMax: -82.0 },
  'new england': { latMin: 41.0, latMax: 47.0, lonMin: -74.0, lonMax: -67.0 },
  'east coast': { latMin: 33.0, latMax: 43.0, lonMin: -81.0, lonMax: -73.0 },
  'west coast': { latMin: 32.0, latMax: 49.0, lonMin: -125.0, lonMax: -117.0 },
  'united kingdom': { latMin: 50.0, latMax: 58.5, lonMin: -8.0, lonMax: 2.0 },
  uk: { latMin: 50.0, latMax: 58.5, lonMin: -8.0, lonMax: 2.0 },
  europe: { latMin: 36.0, latMax: 60.0, lonMin: -10.0, lonMax: 30.0 },
  asia: { latMin: 10.0, latMax: 55.0, lonMin: 60.0, lonMax: 145.0 },
  africa: { latMin: -35.0, latMax: 37.0, lonMin: -18.0, lonMax: 52.0 },
  'north america': { latMin: 25.0, latMax: 55.0, lonMin: -125.0, lonMax: -65.0 },
  'south america': { latMin: -55.0, latMax: 12.0, lonMin: -82.0, lonMax: -35.0 },
  'middle east': { latMin: 12.0, latMax: 42.0, lonMin: 24.0, lonMax: 64.0 },
};

// ─── Zoom Tier Assignment ───

/**
 * Assign a zoom tier based on data source, severity, and geocoding confidence.
 */
export function assignZoomTier(
  source: string,
  severity: string,
  confidence: number,
  isHotspot: boolean,
): ZoomTier {
  // Hotspots are always global
  if (isHotspot) return 'global';

  // High-severity news with strong geo confidence → country
  if (
    (source === 'news' || source === 'osint') &&
    (severity === 'critical' || severity === 'high') &&
    confidence >= 0.8
  ) {
    return 'country';
  }

  // Congress trades and government contracts → city
  if (source === 'congress' || source === 'contracts') {
    return 'city';
  }

  // Whale alerts → city
  if (source === 'whales') {
    return 'city';
  }

  // Medium-severity news → city
  if ((source === 'news' || source === 'osint') && severity === 'medium') {
    return 'city';
  }

  // High-confidence precise geocoding → street
  if (confidence >= 0.95 && (severity === 'low' || severity === 'info')) {
    return 'street';
  }

  // Low-severity news with decent geo → street
  if ((source === 'news' || source === 'osint') && (severity === 'low' || severity === 'info')) {
    return 'street';
  }

  // Default to country
  return 'country';
}

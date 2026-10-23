/**
 * Cyber-domain geo-tagging utility.
 *
 * Scans CVE descriptions, breach reports, AI safety incidents, threat actor
 * profiles, and live cyber RSS for cyber-domain location keywords:
 *   - Vendor HQs (Microsoft → Redmond, CrowdStrike → Austin, ...)
 *   - Cloud regions (us-east-1 → Ashburn, eu-west-2 → London, ...)
 *   - AI lab locations (Anthropic → SF, Mistral → Paris, ...)
 *   - Threat actor home regions (APT28 → Moscow, Lazarus → Pyongyang, ...)
 *   - ICS/OT vendors (Siemens → Munich, Schneider Electric → Paris, ...)
 *
 * Mirrors the pattern in geotag.ts (longest-first sort + word-boundary regex
 * for short keys) but with a cyber-specific keyword/coordinate table. Falls
 * through to the general `geocodeLocation()` for non-cyber locations so that
 * a CVE mentioning "Ukraine" still geotags via the geopolitical table.
 *
 * Returns the shared `GeoResult` shape so it composes with the existing
 * MapDataProvider marker pipeline.
 */

import type { CyberCategory, IntelligenceCategory } from '@/lib/types';
import { greatCircleDistance } from '@/lib/utils/geo';
import { geocodeLocation } from './geocode';
import type { GeoResult } from './geotag';

// ─── Cyber location table ────────────────────────────────────────────────────

interface CyberLocation {
  lat: number;
  lon: number;
  city: string;
  country?: string;
  /** Bucket used to weight downstream category inference. */
  kind: 'vendor' | 'cloud_region' | 'ai_lab' | 'threat_actor' | 'ics_ot' | 'region';
}

const CYBER_LOCATIONS: Record<string, CyberLocation> = {
  // ─── Big tech vendors ──────────────────────────────────────────────────────
  microsoft: { lat: 47.6398, lon: -122.1281, city: 'Redmond', country: 'US', kind: 'vendor' },
  azure: { lat: 47.6398, lon: -122.1281, city: 'Redmond', country: 'US', kind: 'cloud_region' },
  windows: { lat: 47.6398, lon: -122.1281, city: 'Redmond', country: 'US', kind: 'vendor' },
  exchange: { lat: 47.6398, lon: -122.1281, city: 'Redmond', country: 'US', kind: 'vendor' },
  sharepoint: { lat: 47.6398, lon: -122.1281, city: 'Redmond', country: 'US', kind: 'vendor' },
  google: { lat: 37.422, lon: -122.0841, city: 'Mountain View', country: 'US', kind: 'vendor' },
  chrome: { lat: 37.422, lon: -122.0841, city: 'Mountain View', country: 'US', kind: 'vendor' },
  chromium: { lat: 37.422, lon: -122.0841, city: 'Mountain View', country: 'US', kind: 'vendor' },
  apple: { lat: 37.3349, lon: -122.009, city: 'Cupertino', country: 'US', kind: 'vendor' },
  macos: { lat: 37.3349, lon: -122.009, city: 'Cupertino', country: 'US', kind: 'vendor' },
  safari: { lat: 37.3349, lon: -122.009, city: 'Cupertino', country: 'US', kind: 'vendor' },
  amazon: { lat: 47.6062, lon: -122.3321, city: 'Seattle', country: 'US', kind: 'vendor' },
  aws: { lat: 47.6062, lon: -122.3321, city: 'Seattle', country: 'US', kind: 'cloud_region' },
  meta: { lat: 37.4848, lon: -122.1484, city: 'Menlo Park', country: 'US', kind: 'vendor' },
  facebook: { lat: 37.4848, lon: -122.1484, city: 'Menlo Park', country: 'US', kind: 'vendor' },
  whatsapp: { lat: 37.4848, lon: -122.1484, city: 'Menlo Park', country: 'US', kind: 'vendor' },
  oracle: { lat: 30.2672, lon: -97.7431, city: 'Austin', country: 'US', kind: 'vendor' },
  ibm: { lat: 41.1098, lon: -73.7223, city: 'Armonk', country: 'US', kind: 'vendor' },
  cisco: { lat: 37.3382, lon: -121.8863, city: 'San Jose', country: 'US', kind: 'vendor' },
  vmware: { lat: 37.4034, lon: -122.1418, city: 'Palo Alto', country: 'US', kind: 'vendor' },
  esxi: { lat: 37.4034, lon: -122.1418, city: 'Palo Alto', country: 'US', kind: 'vendor' },
  vcenter: { lat: 37.4034, lon: -122.1418, city: 'Palo Alto', country: 'US', kind: 'vendor' },
  broadcom: { lat: 37.3541, lon: -121.9552, city: 'San Jose', country: 'US', kind: 'vendor' },
  nvidia: { lat: 37.3541, lon: -121.9552, city: 'Santa Clara', country: 'US', kind: 'vendor' },
  intel: { lat: 37.3879, lon: -121.9636, city: 'Santa Clara', country: 'US', kind: 'vendor' },
  juniper: { lat: 37.3688, lon: -122.0363, city: 'Sunnyvale', country: 'US', kind: 'vendor' },
  arista: { lat: 37.3541, lon: -121.9552, city: 'Santa Clara', country: 'US', kind: 'vendor' },
  citrix: { lat: 26.1224, lon: -80.1373, city: 'Fort Lauderdale', country: 'US', kind: 'vendor' },
  'red hat': { lat: 35.7796, lon: -78.6382, city: 'Raleigh', country: 'US', kind: 'vendor' },
  redhat: { lat: 35.7796, lon: -78.6382, city: 'Raleigh', country: 'US', kind: 'vendor' },

  // ─── Security vendors ──────────────────────────────────────────────────────
  crowdstrike: { lat: 30.2672, lon: -97.7431, city: 'Austin', country: 'US', kind: 'vendor' },
  'palo alto networks': {
    lat: 37.3879,
    lon: -121.9636,
    city: 'Santa Clara',
    country: 'US',
    kind: 'vendor',
  },
  'pan-os': { lat: 37.3879, lon: -121.9636, city: 'Santa Clara', country: 'US', kind: 'vendor' },
  fortinet: { lat: 37.3688, lon: -122.0363, city: 'Sunnyvale', country: 'US', kind: 'vendor' },
  fortios: { lat: 37.3688, lon: -122.0363, city: 'Sunnyvale', country: 'US', kind: 'vendor' },
  fortigate: { lat: 37.3688, lon: -122.0363, city: 'Sunnyvale', country: 'US', kind: 'vendor' },
  mandiant: { lat: 38.9586, lon: -77.357, city: 'Reston', country: 'US', kind: 'vendor' },
  sentinelone: {
    lat: 37.422,
    lon: -122.0841,
    city: 'Mountain View',
    country: 'US',
    kind: 'vendor',
  },
  rapid7: { lat: 42.3601, lon: -71.0589, city: 'Boston', country: 'US', kind: 'vendor' },
  metasploit: { lat: 42.3601, lon: -71.0589, city: 'Boston', country: 'US', kind: 'vendor' },
  tenable: { lat: 39.2037, lon: -76.861, city: 'Columbia', country: 'US', kind: 'vendor' },
  nessus: { lat: 39.2037, lon: -76.861, city: 'Columbia', country: 'US', kind: 'vendor' },
  qualys: { lat: 37.5585, lon: -122.2711, city: 'Foster City', country: 'US', kind: 'vendor' },
  proofpoint: { lat: 37.3688, lon: -122.0363, city: 'Sunnyvale', country: 'US', kind: 'vendor' },
  sophos: { lat: 42.5047, lon: -71.1956, city: 'Burlington', country: 'US', kind: 'vendor' },
  'trend micro': { lat: 35.6895, lon: 139.6917, city: 'Tokyo', country: 'JP', kind: 'vendor' },
  kaspersky: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'vendor' },
  'check point': { lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', kind: 'vendor' },
  checkpoint: { lat: 32.0853, lon: 34.7818, city: 'Tel Aviv', country: 'IL', kind: 'vendor' },
  cyberark: { lat: 32.0853, lon: 34.7818, city: 'Petach Tikva', country: 'IL', kind: 'vendor' },
  snyk: { lat: 42.3601, lon: -71.0589, city: 'Boston', country: 'US', kind: 'vendor' },
  yubico: { lat: 59.3293, lon: 18.0686, city: 'Stockholm', country: 'SE', kind: 'vendor' },
  darktrace: { lat: 52.2053, lon: 0.1218, city: 'Cambridge', country: 'UK', kind: 'vendor' },
  mimecast: { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', kind: 'vendor' },
  bitsight: { lat: 42.3601, lon: -71.0589, city: 'Boston', country: 'US', kind: 'vendor' },
  okta: { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', kind: 'vendor' },
  auth0: { lat: 47.6101, lon: -122.2015, city: 'Bellevue', country: 'US', kind: 'vendor' },
  '1password': { lat: 43.6532, lon: -79.3832, city: 'Toronto', country: 'CA', kind: 'vendor' },
  duo: { lat: 42.2808, lon: -83.743, city: 'Ann Arbor', country: 'US', kind: 'vendor' },

  // ─── Networking / CDN ──────────────────────────────────────────────────────
  cloudflare: {
    lat: 37.7749,
    lon: -122.4194,
    city: 'San Francisco',
    country: 'US',
    kind: 'vendor',
  },
  akamai: { lat: 42.3736, lon: -71.1097, city: 'Cambridge', country: 'US', kind: 'vendor' },
  fastly: { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', kind: 'vendor' },
  equinix: { lat: 37.4848, lon: -122.2281, city: 'Redwood City', country: 'US', kind: 'vendor' },

  // ─── SaaS / productivity ───────────────────────────────────────────────────
  salesforce: {
    lat: 37.7749,
    lon: -122.4194,
    city: 'San Francisco',
    country: 'US',
    kind: 'vendor',
  },
  adobe: { lat: 37.3382, lon: -121.8863, city: 'San Jose', country: 'US', kind: 'vendor' },
  slack: { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', kind: 'vendor' },
  atlassian: { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', kind: 'vendor' },
  confluence: { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', kind: 'vendor' },
  jira: { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'AU', kind: 'vendor' },
  zoom: { lat: 37.3382, lon: -121.8863, city: 'San Jose', country: 'US', kind: 'vendor' },
  workday: { lat: 37.6624, lon: -121.8747, city: 'Pleasanton', country: 'US', kind: 'vendor' },
  servicenow: { lat: 37.3541, lon: -121.9552, city: 'Santa Clara', country: 'US', kind: 'vendor' },
  stripe: { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', kind: 'vendor' },
  shopify: { lat: 45.4215, lon: -75.6972, city: 'Ottawa', country: 'CA', kind: 'vendor' },
  snowflake: { lat: 37.3879, lon: -121.9636, city: 'Bozeman', country: 'US', kind: 'vendor' },
  databricks: {
    lat: 37.7749,
    lon: -122.4194,
    city: 'San Francisco',
    country: 'US',
    kind: 'vendor',
  },
  hubspot: { lat: 42.3736, lon: -71.1097, city: 'Cambridge', country: 'US', kind: 'vendor' },
  mongodb: { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', kind: 'vendor' },

  // ─── AI labs ───────────────────────────────────────────────────────────────
  anthropic: { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', kind: 'ai_lab' },
  openai: { lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', kind: 'ai_lab' },
  deepmind: { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', kind: 'ai_lab' },
  'meta ai': { lat: 37.4848, lon: -122.1484, city: 'Menlo Park', country: 'US', kind: 'ai_lab' },
  mistral: { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', kind: 'ai_lab' },
  cohere: { lat: 43.6532, lon: -79.3832, city: 'Toronto', country: 'CA', kind: 'ai_lab' },
  xai: { lat: 37.5841, lon: -122.3669, city: 'Burlingame', country: 'US', kind: 'ai_lab' },
  inflection: { lat: 37.4419, lon: -122.143, city: 'Palo Alto', country: 'US', kind: 'ai_lab' },
  runway: { lat: 40.7128, lon: -74.006, city: 'New York', country: 'US', kind: 'ai_lab' },
  stability: { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', kind: 'ai_lab' },
  perplexity: {
    lat: 37.7749,
    lon: -122.4194,
    city: 'San Francisco',
    country: 'US',
    kind: 'ai_lab',
  },

  // ─── ICS / OT vendors ──────────────────────────────────────────────────────
  siemens: { lat: 48.1351, lon: 11.582, city: 'Munich', country: 'DE', kind: 'ics_ot' },
  abb: { lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'CH', kind: 'ics_ot' },
  'schneider electric': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'FR', kind: 'ics_ot' },
  'rockwell automation': {
    lat: 43.0389,
    lon: -87.9065,
    city: 'Milwaukee',
    country: 'US',
    kind: 'ics_ot',
  },
  honeywell: { lat: 35.2271, lon: -80.8431, city: 'Charlotte', country: 'US', kind: 'ics_ot' },
  emerson: { lat: 38.627, lon: -90.1994, city: 'St. Louis', country: 'US', kind: 'ics_ot' },
  'mitsubishi electric': {
    lat: 35.6895,
    lon: 139.6917,
    city: 'Tokyo',
    country: 'JP',
    kind: 'ics_ot',
  },
  yokogawa: { lat: 35.6895, lon: 139.6917, city: 'Tokyo', country: 'JP', kind: 'ics_ot' },
  omron: { lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'JP', kind: 'ics_ot' },

  // ─── AWS regions (precise) ─────────────────────────────────────────────────
  'us-east-1': {
    lat: 39.0438,
    lon: -77.49,
    city: 'N. Virginia',
    country: 'US',
    kind: 'cloud_region',
  },
  'us-east-2': {
    lat: 39.9612,
    lon: -82.9988,
    city: 'Columbus',
    country: 'US',
    kind: 'cloud_region',
  },
  'us-west-1': {
    lat: 37.7749,
    lon: -122.4194,
    city: 'N. California',
    country: 'US',
    kind: 'cloud_region',
  },
  'us-west-2': {
    lat: 45.5152,
    lon: -119.7129,
    city: 'Oregon',
    country: 'US',
    kind: 'cloud_region',
  },
  'eu-west-1': { lat: 53.3498, lon: -6.2603, city: 'Ireland', country: 'IE', kind: 'cloud_region' },
  'eu-west-2': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', kind: 'cloud_region' },
  'eu-central-1': {
    lat: 50.1109,
    lon: 8.6821,
    city: 'Frankfurt',
    country: 'DE',
    kind: 'cloud_region',
  },
  'eu-north-1': {
    lat: 59.3293,
    lon: 18.0686,
    city: 'Stockholm',
    country: 'SE',
    kind: 'cloud_region',
  },
  'ap-northeast-1': {
    lat: 35.6895,
    lon: 139.6917,
    city: 'Tokyo',
    country: 'JP',
    kind: 'cloud_region',
  },
  'ap-northeast-2': {
    lat: 37.5665,
    lon: 126.978,
    city: 'Seoul',
    country: 'KR',
    kind: 'cloud_region',
  },
  'ap-southeast-1': {
    lat: 1.3521,
    lon: 103.8198,
    city: 'Singapore',
    country: 'SG',
    kind: 'cloud_region',
  },
  'ap-southeast-2': {
    lat: -33.8688,
    lon: 151.2093,
    city: 'Sydney',
    country: 'AU',
    kind: 'cloud_region',
  },
  'ap-south-1': { lat: 19.076, lon: 72.8777, city: 'Mumbai', country: 'IN', kind: 'cloud_region' },
  'sa-east-1': {
    lat: -23.5505,
    lon: -46.6333,
    city: 'São Paulo',
    country: 'BR',
    kind: 'cloud_region',
  },
  'ca-central-1': {
    lat: 45.5017,
    lon: -73.5673,
    city: 'Montreal',
    country: 'CA',
    kind: 'cloud_region',
  },

  // ─── Threat actor home regions (in case prose mentions the actor) ──────────
  apt28: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  apt29: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  'fancy bear': { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  'cozy bear': { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  sandworm: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  turla: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  lazarus: { lat: 39.0392, lon: 125.7625, city: 'Pyongyang', country: 'KP', kind: 'threat_actor' },
  kimsuky: { lat: 39.0392, lon: 125.7625, city: 'Pyongyang', country: 'KP', kind: 'threat_actor' },
  andariel: { lat: 39.0392, lon: 125.7625, city: 'Pyongyang', country: 'KP', kind: 'threat_actor' },
  apt41: { lat: 30.5728, lon: 104.0668, city: 'Chengdu', country: 'CN', kind: 'threat_actor' },
  apt40: { lat: 20.0444, lon: 110.1989, city: 'Hainan', country: 'CN', kind: 'threat_actor' },
  apt10: { lat: 39.0842, lon: 117.2009, city: 'Tianjin', country: 'CN', kind: 'threat_actor' },
  'volt typhoon': {
    lat: 20.0444,
    lon: 110.1989,
    city: 'Hainan',
    country: 'CN',
    kind: 'threat_actor',
  },
  'salt typhoon': {
    lat: 39.9042,
    lon: 116.4074,
    city: 'Beijing',
    country: 'CN',
    kind: 'threat_actor',
  },
  'mustang panda': {
    lat: 39.9042,
    lon: 116.4074,
    city: 'Beijing',
    country: 'CN',
    kind: 'threat_actor',
  },
  hafnium: { lat: 39.9042, lon: 116.4074, city: 'Beijing', country: 'CN', kind: 'threat_actor' },
  apt34: { lat: 35.6892, lon: 51.389, city: 'Tehran', country: 'IR', kind: 'threat_actor' },
  oilrig: { lat: 35.6892, lon: 51.389, city: 'Tehran', country: 'IR', kind: 'threat_actor' },
  muddywater: { lat: 35.6892, lon: 51.389, city: 'Tehran', country: 'IR', kind: 'threat_actor' },
  apt35: { lat: 35.6892, lon: 51.389, city: 'Tehran', country: 'IR', kind: 'threat_actor' },
  'charming kitten': {
    lat: 35.6892,
    lon: 51.389,
    city: 'Tehran',
    country: 'IR',
    kind: 'threat_actor',
  },
  lockbit: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  alphv: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  blackcat: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  cl0p: { lat: 50.4501, lon: 30.5234, city: 'Kyiv', country: 'UA', kind: 'threat_actor' },
  conti: {
    lat: 59.9311,
    lon: 30.3609,
    city: 'St. Petersburg',
    country: 'RU',
    kind: 'threat_actor',
  },
  'black basta': {
    lat: 55.7558,
    lon: 37.6173,
    city: 'Moscow',
    country: 'RU',
    kind: 'threat_actor',
  },
  fin7: { lat: 50.4501, lon: 30.5234, city: 'Kyiv', country: 'UA', kind: 'threat_actor' },
  'scattered spider': {
    lat: 51.5074,
    lon: -0.1278,
    city: 'London',
    country: 'UK',
    kind: 'threat_actor',
  },
  ransomhub: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  killnet: { lat: 55.7558, lon: 37.6173, city: 'Moscow', country: 'RU', kind: 'threat_actor' },
  lapsus$: { lat: -23.5505, lon: -46.6333, city: 'São Paulo', country: 'BR', kind: 'threat_actor' },

  // ─── Broad regions (last-resort fallback for victim country) ───────────────
  'european union': { lat: 50.8503, lon: 4.3517, city: 'Brussels', country: 'EU', kind: 'region' },
  'five eyes': { lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', kind: 'region' },
  'u.s. federal': {
    lat: 38.9072,
    lon: -77.0369,
    city: 'Washington DC',
    country: 'US',
    kind: 'region',
  },
  'u.s. military': {
    lat: 38.9072,
    lon: -77.0369,
    city: 'Washington DC',
    country: 'US',
    kind: 'region',
  },
  'cisa kev': { lat: 38.9072, lon: -77.0369, city: 'Washington DC', country: 'US', kind: 'region' },
};

// ─── Pre-compiled sort + word-boundary regex ─────────────────────────────────

// Sort keys longest-first so "palo alto networks" matches before "palo alto",
// "ap-southeast-1" before "ap-southeast", "fancy bear" before "bear", etc.
const CYBER_KEYS = Object.keys(CYBER_LOCATIONS).sort((a, b) => b.length - a.length);

// Short single-token keys need word-boundary regex to avoid false positives
// (e.g. "ibm" must not match in "ibmissed" if that ever appeared).
const SHORT_CYBER_KEYS = new Set(CYBER_KEYS.filter((k) => !k.includes(' ') && !k.includes('-')));

const WORD_BOUNDARY_REGEX = new Map<string, RegExp>();
for (const key of SHORT_CYBER_KEYS) {
  // Escape special characters before composing the regex
  const escaped = key.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&');
  WORD_BOUNDARY_REGEX.set(key, new RegExp(`\\b${escaped}\\b`, 'i'));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Geo-tag arbitrary cyber-domain text. Returns up to `maxResults` GeoResults
 * deduplicated by 100km proximity. Confidence is 1.0 for the first match and
 * 0.85 for subsequent matches; static keyword hits are tagged `source: 'static'`.
 *
 * Falls through to `geocodeLocation()` from the general geopolitical table so
 * a CVE description mentioning "Ukraine" still geotags correctly.
 */
export function cyberGeotagText(text: string, maxResults = 3): GeoResult[] {
  if (!text) return [];

  const normalized = text.toLowerCase();
  const results: GeoResult[] = [];

  // First pass: cyber-specific keyword table
  for (const key of CYBER_KEYS) {
    if (results.length >= maxResults) break;

    let matched = false;
    if (SHORT_CYBER_KEYS.has(key)) {
      const regex = WORD_BOUNDARY_REGEX.get(key);
      if (regex?.test(normalized)) matched = true;
    } else {
      if (normalized.includes(key)) matched = true;
    }
    if (!matched) continue;

    const loc = CYBER_LOCATIONS[key];
    if (!loc) continue;

    if (results.some((r) => greatCircleDistance(r.lat, r.lon, loc.lat, loc.lon) < 100)) {
      continue;
    }

    results.push({
      lat: loc.lat,
      lon: loc.lon,
      name: loc.city,
      confidence: results.length === 0 ? 1.0 : 0.85,
      source: 'static',
    });
  }

  // Second pass: fallback for non-cyber locations (e.g. country mentions in CVE prose)
  if (results.length < maxResults) {
    for (const key of GENERAL_FALLBACK_KEYS) {
      if (results.length >= maxResults) break;
      if (!normalized.includes(key)) continue;

      const geo = geocodeLocation(key);
      if (!geo) continue;

      if (results.some((r) => greatCircleDistance(r.lat, r.lon, geo.lat, geo.lon) < 100)) {
        continue;
      }

      results.push({
        lat: geo.lat,
        lon: geo.lon,
        name: key,
        confidence: 0.6,
        source: 'static',
      });
    }
  }

  return results;
}

/**
 * Look up a single keyword in the cyber table. Returns null for unknown keys.
 * Used by the API route to enrich AEGIS DB rows with display labels.
 */
export function lookupCyberLocation(key: string): CyberLocation | null {
  return CYBER_LOCATIONS[key.toLowerCase()] ?? null;
}

/**
 * Map `NewsItem.aiCategory` and severity to a marker `CyberCategory`. Used by
 * the live RSS stream when converting cyber news into ephemeral markers.
 *
 * AiCategory values come from the Phase 9.2 scoring pipeline:
 *   vendor_incident | defensive | offensive | agentic_safety | unrelated
 */
export function cyberCategoryFromAiCategory(
  aiCategory: string | undefined,
  newsCategory: string,
): CyberCategory {
  const ai = (aiCategory ?? '').toLowerCase();
  const cat = newsCategory.toLowerCase();

  if (ai === 'agentic_safety' || cat === 'ai_safety') return 'ai_safety';
  if (ai === 'vendor_incident') {
    if (cat === 'cve' || cat === 'vulnerability') return 'cve';
    if (cat === 'breach' || cat === 'data_breach') return 'breach';
    return 'cve';
  }
  if (ai === 'offensive' || cat === 'ransomware' || cat === 'apt') return 'threat_actor';
  if (ai === 'defensive') return 'cve';
  if (cat === 'ai' || cat === 'ml') return 'ai_incident';
  return 'cve';
}

/**
 * Map a `CyberCategory` discriminator to the appropriate `IntelligenceCategory`
 * for visual styling (color/icon lookup tables in geo.ts, nato-symbols.ts).
 * Returns the *most severe* IntelligenceCategory the cyber bucket implies; the
 * actual marker `category` field can be overridden by per-item severity logic.
 */
export function intelligenceCategoryFromCyber(
  cyberCategory: CyberCategory,
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info',
): IntelligenceCategory {
  switch (cyberCategory) {
    case 'cve':
      if (severity === 'critical') return 'cve_critical';
      if (severity === 'high') return 'cve_high';
      return 'cve_medium';
    case 'breach':
      return 'data_breach';
    case 'threat_actor':
      return 'apt_activity';
    case 'ai_incident':
      return 'ai_incident';
    case 'ai_safety':
      return 'ai_safety';
    case 'ioc':
      return 'apt_activity';
    case 'critical_infra':
      return 'strategic';
  }
}

// ─── Internal: limited general-fallback keyword set ─────────────────────────
// We pull only countries and broad regions from the geopolitical table; full
// city-level matching would cause noisy cross-domain hits.
const GENERAL_FALLBACK_KEYS = [
  'united states',
  'united kingdom',
  'european union',
  'south korea',
  'north korea',
  'saudi arabia',
  'south africa',
  'middle east',
  'taiwan',
  'ukraine',
  'russia',
  'china',
  'iran',
  'israel',
  'india',
  'brazil',
  'germany',
  'france',
  'japan',
  'australia',
  'canada',
  'singapore',
  'netherlands',
];

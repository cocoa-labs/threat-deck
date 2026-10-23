/**
 * News geo-tagging utility.
 * Scans NewsItem title + summary for location keywords against the
 * existing geocodeLocation() lookup table, with Mapbox API fallback.
 */

import type { IntelligenceCategory, NewsItem, Severity } from '@/lib/types';
import { greatCircleDistance } from '@/lib/utils/geo';
import { geocodeLocation } from './geocode';
import { geocodeForward } from './geocode-api';

export interface GeoResult {
  lat: number;
  lon: number;
  name: string;
  confidence: number;
  source: 'static' | 'mapbox' | 'mapbox-reverse' | 'manual';
}

// All location keys from geocode.ts, pre-sorted longest-first so
// "South China Sea" matches before "China", "North Korea" before "Korea", etc.
const LOCATION_KEYS = [
  // Longest first — multi-word matches before single-word
  'pacific northwest',
  'strait of malacca',
  'strait of hormuz',
  'south china sea',
  'horn of africa',
  'united kingdom',
  'washington dc',
  'north america',
  'south america',
  'saudi arabia',
  'south africa',
  'taiwan strait',
  'silicon valley',
  'us-china tech',
  'persian gulf',
  'north korea',
  'south korea',
  'buenos aires',
  'johannesburg',
  'great plains',
  'mexico city',
  'new england',
  'philippines',
  'afghanistan',
  'netherlands',
  'switzerland',
  'bangladesh',
  'suez canal',
  'middle east',
  'new delhi',
  'hong kong',
  'sao paulo',
  'tel aviv',
  'east coast',
  'west coast',
  'gulf coast',
  'northeast',
  'southeast',
  'southwest',
  'rust belt',
  'sun belt',
  'indonesia',
  'australia',
  'argentina',
  'venezuela',
  'colombia',
  'ethiopia',
  'portugal',
  'pakistan',
  'thailand',
  'malaysia',
  'red sea',
  'washington',
  'new york',
  'pyongyang',
  'jerusalem',
  'singapore',
  'istanbul',
  'brussels',
  'atlantic',
  'ukraine',
  'pacific',
  'kashmir',
  'balkans',
  'toronto',
  'nairobi',
  'myanmar',
  'midwest',
  'vietnam',
  'finland',
  'denmark',
  'nigeria',
  'germany',
  'taiwan',
  'london',
  'moscow',
  'beijing',
  'berlin',
  'mumbai',
  'tehran',
  'riyadh',
  'sydney',
  'geneva',
  'europe',
  'africa',
  'canada',
  'mexico',
  'brazil',
  'poland',
  'norway',
  'sweden',
  'greece',
  'turkey',
  'israel',
  'russia',
  'france',
  'japan',
  'china',
  'india',
  'spain',
  'italy',
  'dubai',
  'cairo',
  'tokyo',
  'delhi',
  'seoul',
  'paris',
  'kyiv',
  'kiev',
  'korea',
  'lagos',
  'sahel',
  'chile',
  'egypt',
  'libya',
  'yemen',
  'syria',
  'cuba',
  'peru',
  'iraq',
  'iran',
  'asia',
  'arctic',
  'taipei',
  'uk',
];

// Keys that are short enough to produce false positives need word-boundary matching
const SHORT_KEYS = new Set(LOCATION_KEYS.filter((k) => !k.includes(' ')));

// Pre-compiled regexes for single-word keys
const WORD_BOUNDARY_REGEX = new Map<string, RegExp>();
for (const key of SHORT_KEYS) {
  WORD_BOUNDARY_REGEX.set(key, new RegExp(`\\b${key}\\b`, 'i'));
}

/**
 * Scan a news item's title + summary for location keywords (sync, static only).
 * Returns the first (longest) match found, or null.
 */
export function geotagNewsItem(item: NewsItem): GeoResult | null {
  const text = `${item.title} ${item.summary ?? ''}`.toLowerCase();

  for (const key of LOCATION_KEYS) {
    if (SHORT_KEYS.has(key)) {
      const regex = WORD_BOUNDARY_REGEX.get(key);
      if (regex?.test(text)) {
        const geo = geocodeLocation(key);
        if (geo)
          return { lat: geo.lat, lon: geo.lon, name: key, confidence: 1.0, source: 'static' };
      }
    } else {
      if (text.includes(key)) {
        const geo = geocodeLocation(key);
        if (geo)
          return { lat: geo.lat, lon: geo.lon, name: key, confidence: 1.0, source: 'static' };
      }
    }
  }

  return null;
}

/**
 * Multi-location variant: returns ALL matched locations (up to 3) instead of just the first.
 * Deduplicates by 100km proximity.
 */
export function geotagNewsItemMulti(item: NewsItem): GeoResult[] {
  const text = `${item.title} ${item.summary ?? ''}`.toLowerCase();
  const results: GeoResult[] = [];

  for (const key of LOCATION_KEYS) {
    if (results.length >= 3) break;

    let matched = false;
    if (SHORT_KEYS.has(key)) {
      const regex = WORD_BOUNDARY_REGEX.get(key);
      if (regex?.test(text)) matched = true;
    } else {
      if (text.includes(key)) matched = true;
    }

    if (!matched) continue;

    const geo = geocodeLocation(key);
    if (!geo) continue;

    // Deduplicate by 100km proximity
    const tooClose = results.some((r) => greatCircleDistance(r.lat, r.lon, geo.lat, geo.lon) < 100);
    if (tooClose) continue;

    results.push({
      lat: geo.lat,
      lon: geo.lon,
      name: key,
      confidence: results.length === 0 ? 1.0 : 0.7,
      source: 'static',
    });
  }

  return results;
}

/**
 * Async version that tries static lookup first, then Mapbox API fallback.
 * Extracts potential location names from the text and geocodes them.
 */
export async function geotagNewsItemAsync(item: NewsItem): Promise<GeoResult | null> {
  // Try static lookup first (fast path)
  const staticResult = geotagNewsItem(item);
  if (staticResult) return staticResult;

  // Extract potential location candidates from title
  // Look for capitalized multi-word phrases that might be place names
  const title = item.title;
  const candidates = extractLocationCandidates(title);

  for (const candidate of candidates) {
    const enriched = await geocodeForward(candidate);
    if (enriched) {
      return {
        lat: enriched.lat,
        lon: enriched.lon,
        name: enriched.name,
        confidence: enriched.confidence,
        source: enriched.source,
      };
    }
  }

  return null;
}

/**
 * Extract potential location names from text.
 * Looks for capitalized words/phrases that might be place names.
 */
function extractLocationCandidates(text: string): string[] {
  const candidates: string[] = [];

  // Match sequences of capitalized words (2+ words, likely place names)
  const multiWordPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  for (const match of text.matchAll(multiWordPattern)) {
    const phrase = match[1]!;
    // Filter out common non-location phrases
    if (!NON_LOCATION_PHRASES.has(phrase.toLowerCase())) {
      candidates.push(phrase);
    }
  }

  return candidates.slice(0, 3); // Limit API calls
}

const NON_LOCATION_PHRASES = new Set([
  'united states',
  'united nations',
  'federal reserve',
  'white house',
  'wall street',
  'silicon valley',
  'climate change',
  'artificial intelligence',
  'machine learning',
  'deep learning',
  'social media',
  'supply chain',
  'interest rate',
  'stock market',
  'trade war',
  'cold war',
  'world war',
]);

/**
 * Map RSS feed categories to IntelligenceCategory.
 */
export function mapNewsCategory(rssCategory: string): IntelligenceCategory {
  const cat = rssCategory.toLowerCase();

  const mapping: Record<string, IntelligenceCategory> = {
    geopolitical: 'conflict',
    defense: 'conflict',
    military: 'conflict',
    war: 'conflict',
    conflict: 'conflict',
    security: 'conflict',

    financial: 'market',
    finance: 'market',
    markets: 'market',
    economy: 'economic',
    economics: 'economic',
    economic: 'economic',
    business: 'market',
    trade: 'economic',

    tech_ai: 'technology',
    technology: 'technology',
    tech: 'technology',
    cyber: 'technology',
    ai: 'technology',
    science: 'technology',

    government_policy: 'policy',
    policy: 'policy',
    politics: 'policy',
    political: 'policy',
    government: 'policy',
    legislation: 'policy',
    regulation: 'policy',

    nuclear: 'proliferation',
    proliferation: 'proliferation',
    weapons: 'proliferation',
    wmd: 'proliferation',

    think_tank: 'strategic',
    strategic: 'strategic',
    analysis: 'strategic',
    intelligence: 'strategic',

    protest: 'instability',
    unrest: 'instability',
    crisis: 'instability',
    humanitarian: 'instability',
    migration: 'instability',

    crypto: 'alternative',
    alternative: 'alternative',
  };

  return mapping[cat] ?? 'strategic';
}

/**
 * Infer severity from an IntelligenceCategory.
 */
export function inferNewsSeverity(category: IntelligenceCategory): Severity {
  const mapping: Record<IntelligenceCategory, Severity> = {
    conflict: 'high',
    proliferation: 'high',
    instability: 'high',
    strategic: 'medium',
    economic: 'medium',
    technology: 'medium',
    policy: 'medium',
    market: 'low',
    alternative: 'low',
    // Cyber categories
    cve_critical: 'critical',
    cve_high: 'high',
    cve_medium: 'medium',
    ai_incident: 'high',
    data_breach: 'high',
    ransomware: 'critical',
    apt_activity: 'high',
    zero_day: 'critical',
    ai_safety: 'medium',
    model_release: 'low',
  };

  return mapping[category];
}

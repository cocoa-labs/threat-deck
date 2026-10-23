/**
 * Auto-extract location references from agent response text.
 * Uses the existing static geocode table for matching.
 */

import { geocodeLocation } from '@/lib/mapbox/geocode';
import { greatCircleDistance } from '@/lib/utils/geo';

export interface ExtractedLocation {
  name: string;
  lat: number;
  lon: number;
  context: string;
}

// Location keys sorted longest-first, matching geotag.ts pattern
const EXTRACT_KEYS = [
  'strait of malacca',
  'strait of hormuz',
  'south china sea',
  'horn of africa',
  'united kingdom',
  'washington dc',
  'taiwan strait',
  'silicon valley',
  'persian gulf',
  'north korea',
  'south korea',
  'saudi arabia',
  'south africa',
  'middle east',
  'philippines',
  'afghanistan',
  'netherlands',
  'switzerland',
  'bangladesh',
  'suez canal',
  'new delhi',
  'hong kong',
  'sao paulo',
  'tel aviv',
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
  'ukraine',
  'kashmir',
  'balkans',
  'toronto',
  'nairobi',
  'myanmar',
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
  'korea',
  'egypt',
  'libya',
  'yemen',
  'syria',
  'cuba',
  'peru',
  'iraq',
  'iran',
  'taipei',
];

// Short keys need word-boundary matching
const SHORT_KEYS = new Set(EXTRACT_KEYS.filter((k) => !k.includes(' ')));
const WORD_REGEX = new Map<string, RegExp>();
for (const key of SHORT_KEYS) {
  WORD_REGEX.set(key, new RegExp(`\\b${key}\\b`, 'i'));
}

/**
 * Extract location references from agent response text.
 * Returns up to 5 unique locations with surrounding context.
 */
export function extractLocationsFromText(text: string): ExtractedLocation[] {
  const lower = text.toLowerCase();
  const results: ExtractedLocation[] = [];

  for (const key of EXTRACT_KEYS) {
    if (results.length >= 5) break;

    let matched = false;
    if (SHORT_KEYS.has(key)) {
      const regex = WORD_REGEX.get(key);
      if (regex?.test(lower)) matched = true;
    } else {
      if (lower.includes(key)) matched = true;
    }

    if (!matched) continue;

    const geo = geocodeLocation(key);
    if (!geo) continue;

    // Deduplicate by 100km proximity
    const tooClose = results.some((r) => greatCircleDistance(r.lat, r.lon, geo.lat, geo.lon) < 100);
    if (tooClose) continue;

    // Extract surrounding context sentence
    const idx = lower.indexOf(key);
    const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
    const end = text.indexOf('.', idx + key.length);
    const context = text.slice(start, end > 0 ? end + 1 : start + 120).trim();

    results.push({
      name: key,
      lat: geo.lat,
      lon: geo.lon,
      context: context.slice(0, 120),
    });
  }

  return results;
}

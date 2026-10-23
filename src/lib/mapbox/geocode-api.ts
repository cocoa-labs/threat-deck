/**
 * Mapbox Geocoding API client with LRU cache.
 * Falls back to the static geocodeLocation() for known locations.
 */

import type { EnrichedGeoLocation } from '@/lib/types';
import { geocodeLocation } from './geocode';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAX_CACHE_SIZE = 500;
const RATE_LIMIT_INTERVAL_MS = 100; // 10 req/sec

// ─── LRU Cache ───

const cache = new Map<string, EnrichedGeoLocation | null>();

function lruGet(key: string): EnrichedGeoLocation | null | undefined {
  if (!cache.has(key)) return undefined;
  const val = cache.get(key)!;
  // Move to end (most recently used)
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function lruSet(key: string, val: EnrichedGeoLocation | null): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  // Evict oldest if over capacity
  if (cache.size > MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// ─── Rate Limiter ───

let lastRequestTime = 0;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

// ─── Geocoding ───

/**
 * Reverse geocode a lat/lon coordinate to an address or place name.
 * Best-effort: returns null on failure, never throws.
 */
export async function geocodeReverse(
  lat: number,
  lon: number,
): Promise<EnrichedGeoLocation | null> {
  const key = `rev:${lat.toFixed(5)},${lon.toFixed(5)}`;

  // LRU cache check
  const cached = lruGet(key);
  if (cached !== undefined) return cached;

  if (!MAPBOX_TOKEN) {
    lruSet(key, null);
    return null;
  }

  try {
    await waitForRateLimit();

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,neighborhood,locality,place&limit=1`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[geocode-api] Reverse geocode returned ${res.status} for ${lat},${lon}`);
      lruSet(key, null);
      return null;
    }

    const data = (await res.json()) as {
      features: Array<{
        center: [number, number];
        place_name: string;
        relevance: number;
        context?: Array<{ id: string; text: string }>;
        place_type: string[];
      }>;
    };

    const feature = data.features[0];
    if (!feature) {
      lruSet(key, null);
      return null;
    }

    // Extract context fields
    const contextMap: Record<string, string> = {};
    if (feature.context) {
      for (const ctx of feature.context) {
        const type = ctx.id.split('.')[0];
        if (type) contextMap[type] = ctx.text;
      }
    }

    const result: EnrichedGeoLocation = {
      lat: feature.center[1]!,
      lon: feature.center[0]!,
      name: feature.place_name,
      country: contextMap.country,
      region: contextMap.region,
      city: contextMap.place ?? contextMap.locality,
      confidence: feature.relevance,
      source: 'mapbox-reverse',
    };

    lruSet(key, result);
    return result;
  } catch (err) {
    console.warn(`[geocode-api] Reverse geocode failed for ${lat},${lon}:`, err);
    lruSet(key, null);
    return null;
  }
}

/**
 * Forward geocode a location query.
 * 1. Check static lookup table first (fast path)
 * 2. Check LRU cache
 * 3. Call Mapbox Geocoding API
 */
export async function geocodeForward(query: string): Promise<EnrichedGeoLocation | null> {
  const key = query.toLowerCase().trim();
  if (!key) return null;

  // Fast path: exact static lookup
  const staticResult = geocodeLocation(key);
  if (staticResult) {
    return {
      lat: staticResult.lat,
      lon: staticResult.lon,
      name: key,
      confidence: 1.0,
      source: 'static',
    };
  }

  // For compound queries like "Lincoln Park Zoo, Chicago, Illinois",
  // skip fuzzy segment matching — it would match the parent geography
  // ("Chicago") instead of the specific venue. The Mapbox API handles
  // compound queries with pinpoint accuracy.

  // LRU cache check
  const cached = lruGet(key);
  if (cached !== undefined) return cached;

  // Mapbox API call
  if (!MAPBOX_TOKEN) {
    lruSet(key, null);
    return null;
  }

  try {
    await waitForRateLimit();

    const params = new URLSearchParams({
      q: key,
      access_token: MAPBOX_TOKEN,
      limit: '1',
      language: 'en',
      types: 'country,region,place,locality,neighborhood,address',
    });
    const url = `https://api.mapbox.com/search/geocode/v6/forward?${params}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[geocode-api] Mapbox returned ${res.status} for "${key}"`);
      lruSet(key, null);
      return null;
    }

    const data = (await res.json()) as {
      features?: Array<{
        geometry: { coordinates: [number, number] };
        properties: {
          name?: string;
          full_address?: string;
          place_formatted?: string;
          feature_type?: string;
          match_code?: { confidence?: string };
          context?: {
            country?: { name?: string };
            region?: { name?: string };
            place?: { name?: string };
            locality?: { name?: string };
          };
        };
      }>;
    };

    // Map v6 match_code.confidence string → numeric 0-1
    const confidenceMap: Record<string, number> = {
      exact: 1.0,
      high: 0.9,
      medium: 0.7,
      low: 0.5,
    };

    const feature = data.features?.[0];
    if (!feature) {
      lruSet(key, null);
      return null;
    }

    const props = feature.properties;
    const confidence = confidenceMap[props.match_code?.confidence ?? ''] ?? 0.8;

    // Reject low-confidence results (equivalent to old relevance < 0.5 check)
    if (confidence < 0.5) {
      lruSet(key, null);
      return null;
    }

    const result: EnrichedGeoLocation = {
      lat: feature.geometry.coordinates[1]!,
      lon: feature.geometry.coordinates[0]!,
      name: [props.name, props.place_formatted].filter(Boolean).join(', ') || key,
      country: props.context?.country?.name,
      region: props.context?.region?.name,
      city: props.context?.place?.name ?? props.context?.locality?.name,
      confidence,
      source: 'mapbox',
    };

    lruSet(key, result);
    return result;
  } catch (err) {
    console.warn(`[geocode-api] Failed to geocode "${key}":`, err);
    lruSet(key, null);
    return null;
  }
}

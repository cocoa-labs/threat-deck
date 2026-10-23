/**
 * Viewport Snapshot Capture — Client-side utility.
 *
 * Calls map.queryRenderedFeatures() to read visible POIs, buildings, and landmarks,
 * then filters and categorizes them for agent consumption.
 *
 * Adaptive zoom filtering:
 *   - Zoom 10-14 (city): Max 10 features. Government, military, financial, embassy, ports, airports.
 *   - Zoom 15-17 (district): Max 25 features. Add hospitals, universities, transit, museums, stadiums.
 *   - Zoom 18+ (street): Max 50 features. Add hotels, landmarks, major commercial, parks.
 *   - Below zoom 10: No POI capture (too zoomed out for meaningful features).
 */

import type { Map as MapboxMap, PointLike } from 'mapbox-gl';
import type { MapBaseStyle } from '@/lib/store/map-store';

export interface ViewportFeature {
  name: string;
  category: string;
  type: string;
  lat: number;
  lon: number;
}

export interface ViewportSnapshot {
  center: { lat: number; lon: number };
  zoom: number;
  bearing: number;
  pitch: number;
  zoomTier: 'global' | 'country' | 'city' | 'street';
  baseStyle: MapBaseStyle;
  activeLayers: string[];
  klammerMarkers: { label: string; category: string; severity: string }[];
  features: ViewportFeature[];
  capturedAt: string;
}

// ─── Category Classification ───

/** Intelligence priority order — higher index = lower priority */
const CATEGORY_PRIORITY: Record<string, number> = {
  government: 0,
  military: 1,
  financial: 2,
  transit: 3,
  infrastructure: 4,
  medical: 5,
  education: 6,
  landmark: 7,
  religious: 8,
  park: 9,
  commercial: 10,
};

/**
 * Map a Mapbox feature's `maki` icon or `class` property to an intelligence category.
 * Returns null for features that should be skipped.
 */
function classifyFeature(
  maki: string | undefined,
  featureClass: string | undefined,
  layerId: string,
): string | null {
  const m = maki?.toLowerCase() ?? '';
  const c = featureClass?.toLowerCase() ?? '';

  // Skip roads — too noisy
  if (layerId.includes('road') || layerId.includes('tunnel') || layerId.includes('bridge')) {
    return null;
  }

  // Government & military
  if (
    m === 'embassy' ||
    m === 'town-hall' ||
    c === 'embassy' ||
    c === 'government' ||
    c === 'town_hall' ||
    c === 'courthouse'
  ) {
    return 'government';
  }
  if (m === 'castle' || c === 'military') return 'military';

  // Financial
  if (m === 'bank' || m === 'commercial' || c === 'bank' || c === 'financial') return 'financial';

  // Transit & infrastructure
  if (
    m === 'airport' ||
    m === 'heliport' ||
    m === 'ferry' ||
    m === 'rail' ||
    m === 'rail-light' ||
    m === 'bus' ||
    c === 'airport' ||
    c === 'aerodrome' ||
    c === 'rail' ||
    c === 'bus'
  ) {
    return 'transit';
  }
  if (m === 'harbor' || m === 'dam' || c === 'port' || c === 'dam') return 'infrastructure';

  // Medical
  if (m === 'hospital' || m === 'doctor' || m === 'pharmacy' || c === 'hospital') return 'medical';

  // Education
  if (
    m === 'college' ||
    m === 'school' ||
    c === 'university' ||
    c === 'college' ||
    c === 'school'
  ) {
    return 'education';
  }

  // Landmarks & culture
  if (
    m === 'monument' ||
    m === 'museum' ||
    m === 'theatre' ||
    m === 'stadium' ||
    m === 'attraction' ||
    c === 'museum' ||
    c === 'monument' ||
    c === 'stadium'
  ) {
    return 'landmark';
  }

  // Religious
  if (
    m === 'place-of-worship' ||
    m === 'religious-christian' ||
    m === 'religious-jewish' ||
    m === 'religious-muslim' ||
    c === 'place_of_worship'
  ) {
    return 'religious';
  }

  // Parks
  if (m === 'park' || m === 'garden' || c === 'park' || c === 'national_park') return 'park';

  // Hotels & commercial
  if (m === 'lodging' || m === 'hotel' || c === 'hotel') return 'commercial';

  // Buildings with names (from building layer)
  if (layerId.includes('building')) return 'landmark';

  // Place labels (neighborhoods, cities)
  if (layerId.includes('place-label') || layerId.includes('settlement')) return 'landmark';

  // POI label fallback — only if none of above matched
  if (layerId.includes('poi')) return 'commercial';

  return null;
}

/** Zoom-tier feature limits and allowed categories */
function getZoomConfig(zoom: number): { maxFeatures: number; allowedCategories: Set<string> } {
  if (zoom < 10) {
    return { maxFeatures: 0, allowedCategories: new Set() };
  }
  if (zoom < 15) {
    // City level: strategic features only
    return {
      maxFeatures: 10,
      allowedCategories: new Set([
        'government',
        'military',
        'financial',
        'transit',
        'infrastructure',
      ]),
    };
  }
  if (zoom < 18) {
    // District level: add civic/cultural
    return {
      maxFeatures: 25,
      allowedCategories: new Set([
        'government',
        'military',
        'financial',
        'transit',
        'infrastructure',
        'medical',
        'education',
        'landmark',
      ]),
    };
  }
  // Street level: all categories
  return {
    maxFeatures: 50,
    allowedCategories: new Set(Object.keys(CATEGORY_PRIORITY)),
  };
}

function getZoomTier(zoom: number): 'global' | 'country' | 'city' | 'street' {
  if (zoom < 4) return 'global';
  if (zoom < 10) return 'country';
  if (zoom < 15) return 'city';
  return 'street';
}

/**
 * Capture a snapshot of the current map viewport including visible features.
 * Call this client-side before sending an agent request.
 */
export function captureViewportSnapshot(
  map: MapboxMap,
  options?: {
    baseStyle?: MapBaseStyle;
    activeLayers?: string[];
    klammerMarkers?: { label: string; category: string; severity: string }[];
  },
): ViewportSnapshot {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();
  const pitch = map.getPitch();
  const zoomTier = getZoomTier(zoom);
  const { maxFeatures, allowedCategories } = getZoomConfig(zoom);

  let features: ViewportFeature[] = [];

  if (maxFeatures > 0) {
    const rawFeatures = map.queryRenderedFeatures();
    const seen = new Set<string>();

    const candidates: ViewportFeature[] = [];

    for (const f of rawFeatures) {
      const props = f.properties;
      if (!props) continue;

      const name = (props.name_en as string) ?? (props.name as string);
      if (!name || typeof name !== 'string') continue;

      // Deduplicate by name
      const nameKey = name.toLowerCase();
      if (seen.has(nameKey)) continue;

      const layerId = f.layer?.id ?? '';
      const maki = props.maki as string | undefined;
      const featureClass = (props.class as string) ?? (props.type as string);

      const category = classifyFeature(maki, featureClass, layerId);
      if (!category || !allowedCategories.has(category)) continue;

      seen.add(nameKey);

      // Extract coordinates
      let lat: number;
      let lon: number;
      if (f.geometry.type === 'Point') {
        lon = f.geometry.coordinates[0]!;
        lat = f.geometry.coordinates[1]!;
      } else {
        // For polygons/lines, use the centroid approximation from bounds
        const bounds = map.getBounds();
        if (!bounds) continue;
        lat = bounds.getCenter().lat;
        lon = bounds.getCenter().lng;
      }

      candidates.push({
        name,
        category,
        type: featureClass ?? maki ?? 'unknown',
        lat,
        lon,
      });
    }

    // Sort by intelligence priority
    candidates.sort(
      (a, b) => (CATEGORY_PRIORITY[a.category] ?? 99) - (CATEGORY_PRIORITY[b.category] ?? 99),
    );

    features = candidates.slice(0, maxFeatures);
  }

  return {
    center: { lat: center.lat, lon: center.lng },
    zoom,
    bearing,
    pitch,
    zoomTier,
    baseStyle: options?.baseStyle ?? 'dark',
    activeLayers: options?.activeLayers ?? [],
    klammerMarkers: options?.klammerMarkers ?? [],
    features,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Query features near a specific point on the map (for context menu / POI click).
 * Returns categorized features within a pixel radius of the click point.
 */
export function queryFeaturesAtPoint(
  map: MapboxMap,
  point: { x: number; y: number },
  radius = 20,
): ViewportFeature[] {
  const bbox: [PointLike, PointLike] = [
    [point.x - radius, point.y - radius],
    [point.x + radius, point.y + radius],
  ];

  const rawFeatures = map.queryRenderedFeatures(bbox);
  const seen = new Set<string>();
  const results: ViewportFeature[] = [];

  for (const f of rawFeatures) {
    const props = f.properties;
    if (!props) continue;

    const name = (props.name_en as string) ?? (props.name as string);
    if (!name || typeof name !== 'string') continue;

    const nameKey = name.toLowerCase();
    if (seen.has(nameKey)) continue;

    const layerId = f.layer?.id ?? '';
    const maki = props.maki as string | undefined;
    const featureClass = (props.class as string) ?? (props.type as string);

    const category = classifyFeature(maki, featureClass, layerId);
    if (!category) continue;

    seen.add(nameKey);

    let lat: number;
    let lon: number;
    if (f.geometry.type === 'Point') {
      lon = f.geometry.coordinates[0]!;
      lat = f.geometry.coordinates[1]!;
    } else {
      const bounds = map.getBounds();
      if (!bounds) continue;
      lat = bounds.getCenter().lat;
      lon = bounds.getCenter().lng;
    }

    results.push({
      name,
      category,
      type: featureClass ?? maki ?? 'unknown',
      lat,
      lon,
    });
  }

  return results.slice(0, 10);
}

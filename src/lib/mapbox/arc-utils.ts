import type { GlobeArc } from '@/lib/types';

/**
 * Generate a curved arc as GeoJSON coordinates using a quadratic bezier curve.
 * The midpoint is offset perpendicular to the line between start and end.
 */
export function curvedArcGeoJSON(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  segments: number = 40,
): [number, number][] {
  // Midpoint
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;

  // Perpendicular offset (15% of distance)
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const distance = Math.sqrt(dLat * dLat + dLon * dLon);
  const offset = distance * 0.15;

  // Perpendicular direction (rotate 90 degrees)
  const perpLat = -dLon / distance;
  const perpLon = dLat / distance;

  // Control point
  const ctrlLat = midLat + perpLat * offset;
  const ctrlLon = midLon + perpLon * offset;

  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const oneMinusT = 1 - t;

    // Quadratic bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
    const lat = oneMinusT * oneMinusT * lat1 + 2 * oneMinusT * t * ctrlLat + t * t * lat2;
    const lon = oneMinusT * oneMinusT * lon1 + 2 * oneMinusT * t * ctrlLon + t * t * lon2;

    // GeoJSON uses [lon, lat]
    coords.push([lon, lat]);
  }

  return coords;
}

/**
 * Convert GlobeArc[] to a GeoJSON FeatureCollection of LineString features.
 */
export function arcsToGeoJSON(arcs: GlobeArc[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: arcs.map((arc) => ({
      type: 'Feature' as const,
      properties: {
        id: arc.id,
        color: arc.color,
        label: arc.label ?? '',
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: curvedArcGeoJSON(arc.fromLat, arc.fromLon, arc.toLat, arc.toLon),
      },
    })),
  };
}

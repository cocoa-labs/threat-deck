'use client';

import type { HeatmapLayer } from 'mapbox-gl';
import { useMemo } from 'react';
import { Layer, Source } from 'react-map-gl/mapbox';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeMarker } from '@/lib/types';
import { markerBelongsToLayer, markerVisibleForActiveLayers } from '@/lib/utils/cyber-markers';

interface Props {
  markers: GlobeMarker[];
  visible: boolean;
  beforeId?: string;
}

/** Severity → heatmap weight */
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  info: 0.1,
};

export function MapHeatmapLayer({ markers, visible, beforeId = 'klammer-pulse-ring' }: Props) {
  const categoryFilter = useMapStore((s) => s.categoryFilter);
  const activeLayers = useMapStore((s) => s.activeLayers);
  const isolatedLayer = useMapStore((s) => s.isolatedLayer);
  const severityFilter = useMapStore((s) => s.severityFilter);

  const geojson = useMemo((): GeoJSON.FeatureCollection => {
    const filtered = markers.filter((marker) => {
      if (isolatedLayer && !markerBelongsToLayer(marker, isolatedLayer)) return false;
      if (severityFilter && marker.severity !== severityFilter) return false;
      if (!markerVisibleForActiveLayers(marker, activeLayers)) return false;
      if (categoryFilter && !categoryFilter.has(marker.category)) return false;
      return true;
    });

    return {
      type: 'FeatureCollection',
      features: filtered.map((marker) => ({
        type: 'Feature' as const,
        properties: {
          weight: SEVERITY_WEIGHT[marker.severity] ?? 0.1,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [marker.lon, marker.lat],
        },
      })),
    };
  }, [markers, categoryFilter, activeLayers, isolatedLayer, severityFilter]);

  const heatmapLayer: HeatmapLayer = {
    id: 'klammer-heatmap',
    type: 'heatmap',
    source: 'klammer-heatmap-source',
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
    paint: {
      // Weight by severity property
      'heatmap-weight': ['get', 'weight'],

      // Intensity scales with zoom
      'heatmap-intensity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.6,
        5,
        1.0,
        9,
        1.5,
        12,
        0.5,
        15,
        0.1,
      ],

      // Radius scales with zoom: 20px at z0, 40px at z5, 60px at z9
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 20, 5, 40, 9, 60, 12, 40, 15, 20],

      // WarGames color ramp: transparent → dark blue → cyan → amber → red
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(0,0,0,0)',
        0.2,
        'rgba(10,20,80,0.4)',
        0.4,
        'rgba(0,100,180,0.6)',
        0.6,
        'rgba(0,170,255,0.7)',
        0.8,
        'rgba(255,170,0,0.8)',
        1.0,
        'rgba(255,0,64,0.9)',
      ],

      // Opacity fades at higher zoom so markers remain visible
      'heatmap-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0.6,
        5,
        0.5,
        9,
        0.3,
        12,
        0.1,
        15,
        0.02,
      ],
    },
  };

  return (
    <Source id="klammer-heatmap-source" type="geojson" data={geojson}>
      <Layer {...(beforeId ? { beforeId } : {})} {...heatmapLayer} />
    </Source>
  );
}

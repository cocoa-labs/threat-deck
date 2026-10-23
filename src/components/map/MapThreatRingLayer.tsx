'use client';

import type { CircleLayer } from 'mapbox-gl';
import { useEffect, useMemo, useRef } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/mapbox';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeMarker } from '@/lib/types';
import { markerBelongsToLayer, markerVisibleForActiveLayers } from '@/lib/utils/cyber-markers';
import { severityToHex } from '@/lib/utils/geo';

interface Props {
  markers: GlobeMarker[];
  visible: boolean;
}

const RING_COUNT = 3;
const RING_STAGGER = 0.8; // seconds between rings
const RING_CYCLE_DURATION = 2.4; // seconds for full cycle

export function MapThreatRingLayer({ markers, visible }: Props) {
  const categoryFilter = useMapStore((s) => s.categoryFilter);
  const activeLayers = useMapStore((s) => s.activeLayers);
  const isolatedLayer = useMapStore((s) => s.isolatedLayer);
  const severityFilter = useMapStore((s) => s.severityFilter);
  const { current: map } = useMap();
  const animationRef = useRef<number>(0);

  // Filter to critical + high severity only
  const geojson = useMemo((): GeoJSON.FeatureCollection => {
    const filtered = markers.filter((marker) => {
      if (marker.severity !== 'critical' && marker.severity !== 'high') return false;
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
          id: marker.id,
          color: severityToHex(marker.severity),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [marker.lon, marker.lat],
        },
      })),
    };
  }, [markers, categoryFilter, activeLayers, isolatedLayer, severityFilter]);

  // Animate 3 rings expanding outward
  useEffect(() => {
    if (!visible) return;

    let lastFrame = 0;
    const animate = () => {
      const now = performance.now();
      if (now - lastFrame >= 33) {
        lastFrame = now;
        const t = now / 1000; // seconds
        const mapInstance = map?.getMap();
        if (!mapInstance) {
          animationRef.current = requestAnimationFrame(animate);
          return;
        }

        if (!mapInstance.isStyleLoaded()) {
          animationRef.current = requestAnimationFrame(animate);
          return;
        }

        const zoom = mapInstance.getZoom();
        const zoomScale = zoom <= 10 ? 1.0 : Math.max(0.3, 1.0 - (zoom - 10) * 0.14);
        const opacityScale = zoom <= 10 ? 1.0 : Math.max(0.15, 1.0 - (zoom - 10) * 0.17);

        for (let i = 0; i < RING_COUNT; i++) {
          const layerId = `klammer-threat-ring-${i}`;
          if (!mapInstance.getLayer(layerId)) continue;

          const elapsed = t + i * RING_STAGGER;
          const cycle = (elapsed / RING_CYCLE_DURATION) % 1.0;

          const radius = (15 + cycle * 65) * zoomScale;
          const opacity = (1 - cycle) ** 2 * 0.35 * opacityScale;

          mapInstance.setPaintProperty(layerId, 'circle-radius', radius);
          mapInstance.setPaintProperty(layerId, 'circle-opacity', opacity);
        }
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [map, visible]);

  // Generate 3 staggered ring layers
  const ringLayers: CircleLayer[] = Array.from({ length: RING_COUNT }, (_, i) => ({
    id: `klammer-threat-ring-${i}`,
    type: 'circle' as const,
    source: 'klammer-threat-rings',
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
    paint: {
      'circle-color': ['get', 'color'] as unknown as string,
      'circle-radius': 15,
      'circle-opacity': 0.35,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': ['get', 'color'] as unknown as string,
      'circle-stroke-opacity': 0.2,
    },
  }));

  return (
    <Source id="klammer-threat-rings" type="geojson" data={geojson}>
      {ringLayers.map((layer) => (
        <Layer key={layer.id} {...layer} />
      ))}
    </Source>
  );
}

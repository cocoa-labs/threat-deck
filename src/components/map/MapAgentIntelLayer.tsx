'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Source } from 'react-map-gl/mapbox';
import { useDataStore } from '@/lib/store/data-store';

/**
 * Renders agent intelligence markers with animated glow + TTL-based fade.
 * Uses a GeoJSON source with 3 layers: glow ring, core dot, and text label.
 */
interface Props {
  visible?: boolean;
}

export function MapAgentIntelLayer({ visible = true }: Props) {
  const agentIntelMarkers = useDataStore((s) => s.agentIntelMarkers);
  const removeExpired = useDataStore((s) => s.removeExpiredAgentIntelMarkers);
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Expiry timer: every 5s, remove expired markers and trigger re-render
  useEffect(() => {
    if (!visible || agentIntelMarkers.length === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!intervalRef.current) {
      intervalRef.current = setInterval(() => {
        removeExpired();
        setTick((t) => t + 1);
      }, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [agentIntelMarkers.length, removeExpired, visible]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces recalculation on timer for TTL-based opacity fade
  const geojson = useMemo((): GeoJSON.FeatureCollection => {
    const now = Date.now();
    return {
      type: 'FeatureCollection',
      features: agentIntelMarkers.map((m) => {
        const elapsed = (now - m.createdAt) / 1000;
        const remaining = Math.max(0, m.ttl - elapsed);
        // Full opacity until last 30% of TTL, then linear fade
        const fadeThreshold = m.ttl * 0.3;
        const opacity = remaining > fadeThreshold ? 1.0 : remaining / fadeThreshold;

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [m.lon, m.lat],
          },
          properties: {
            id: m.id,
            label: m.label,
            description: m.description,
            severity: m.severity,
            category: m.category,
            glowColor: m.glowColor,
            opacity: Math.max(0.05, opacity),
          },
        };
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIntelMarkers, tick]);

  if (agentIntelMarkers.length === 0) return null;

  return (
    <Source id="agent-intel-source" type="geojson" data={geojson}>
      {/* Glow ring */}
      <Layer
        id="agent-intel-glow"
        type="circle"
        layout={{ visibility: visible ? 'visible' : 'none' }}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 28, 5, 24, 10, 22, 15, 20],
          'circle-color': ['get', 'glowColor'],
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', ['get', 'opacity'], 0.25],
            10,
            ['*', ['get', 'opacity'], 0.25],
            15,
            ['*', ['get', 'opacity'], 0.075],
          ],
          'circle-blur': 1,
        }}
      />
      {/* Core dot */}
      <Layer
        id="agent-intel-dot"
        type="circle"
        layout={{ visibility: visible ? 'visible' : 'none' }}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 9, 5, 8, 10, 7, 15, 6],
          'circle-color': ['get', 'glowColor'],
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['get', 'opacity'],
            10,
            ['get', 'opacity'],
            15,
            ['*', ['get', 'opacity'], 0.3],
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', ['get', 'opacity'], 0.6],
            10,
            ['*', ['get', 'opacity'], 0.6],
            15,
            ['*', ['get', 'opacity'], 0.18],
          ],
        }}
      />
      {/* Text label */}
      <Layer
        id="agent-intel-label"
        type="symbol"
        layout={{
          visibility: visible ? 'visible' : 'none',
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-max-width': 12,
        }}
        paint={{
          'text-color': ['get', 'glowColor'],
          'text-opacity': ['get', 'opacity'],
          'text-halo-color': '#000000',
          'text-halo-width': 1,
        }}
      />
    </Source>
  );
}

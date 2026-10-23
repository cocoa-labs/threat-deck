'use client';

import type { CircleLayer, SymbolLayer } from 'mapbox-gl';
import { useEffect, useMemo, useRef } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/mapbox';
import { useMapStore } from '@/lib/store/map-store';

const RING_COUNT = 3;
const RING_STAGGER = 0.6; // seconds between rings
const RING_CYCLE_DURATION = 2.0; // seconds for full cycle
const EXPIRE_CHECK_INTERVAL = 1000; // ms

export function MapAttentionPulseLayer() {
  const attentionPulses = useMapStore((s) => s.attentionPulses);
  const removeAttentionPulse = useMapStore((s) => s.removeAttentionPulse);
  const { current: map } = useMap();
  const animationRef = useRef<number>(0);

  // Auto-remove expired pulses
  useEffect(() => {
    if (attentionPulses.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      for (const pulse of attentionPulses) {
        if (now - pulse.startTime > pulse.duration * 1000) {
          removeAttentionPulse(pulse.id);
        }
      }
    }, EXPIRE_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [attentionPulses, removeAttentionPulse]);

  // Build GeoJSON from active pulses
  const geojson = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: 'FeatureCollection',
      features: attentionPulses.map((pulse) => ({
        type: 'Feature' as const,
        properties: {
          id: pulse.id,
          color: pulse.color,
          label: pulse.label,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [pulse.lon, pulse.lat],
        },
      })),
    }),
    [attentionPulses],
  );

  // Animate rings: expand + fade
  useEffect(() => {
    if (attentionPulses.length === 0) return;

    let lastFrame = 0;
    const animate = () => {
      const now = performance.now();
      if (now - lastFrame >= 33) {
        lastFrame = now;
        const t = now / 1000;
        const mapInstance = map?.getMap();
        if (!mapInstance) {
          animationRef.current = requestAnimationFrame(animate);
          return;
        }

        const zoom = mapInstance.getZoom();
        const zoomScale = zoom <= 10 ? 1.0 : Math.max(0.3, 1.0 - (zoom - 10) * 0.14);
        const opacityScale = zoom <= 10 ? 1.0 : Math.max(0.15, 1.0 - (zoom - 10) * 0.17);

        for (let i = 0; i < RING_COUNT; i++) {
          const layerId = `klammer-attention-ring-${i}`;
          if (!mapInstance.getLayer(layerId)) continue;

          const elapsed = t + i * RING_STAGGER;
          const cycle = (elapsed / RING_CYCLE_DURATION) % 1.0;

          const radius = (10 + cycle * 50) * zoomScale;
          const opacity = (1 - cycle) ** 2 * 0.5 * opacityScale;

          mapInstance.setPaintProperty(layerId, 'circle-radius', radius);
          mapInstance.setPaintProperty(layerId, 'circle-opacity', opacity);
        }
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [map, attentionPulses.length]);

  if (attentionPulses.length === 0) return null;

  // 3 staggered ring layers
  const ringLayers: CircleLayer[] = Array.from({ length: RING_COUNT }, (_, i) => ({
    id: `klammer-attention-ring-${i}`,
    type: 'circle' as const,
    source: 'klammer-attention-pulses',
    paint: {
      'circle-color': ['get', 'color'] as unknown as string,
      'circle-radius': 10,
      'circle-opacity': 0.5,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': ['get', 'color'] as unknown as string,
      'circle-stroke-opacity': 0.15,
    },
  }));

  // Label layer
  const labelLayer: SymbolLayer = {
    id: 'klammer-attention-label',
    type: 'symbol' as const,
    source: 'klammer-attention-pulses',
    layout: {
      'text-field': ['get', 'label'] as unknown as string,
      'text-size': 11,
      'text-offset': [0, -2],
      'text-anchor': 'bottom',
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#000000',
      'text-halo-width': 1.5,
    },
  };

  return (
    <Source id="klammer-attention-pulses" type="geojson" data={geojson}>
      {ringLayers.map((layer) => (
        <Layer key={layer.id} {...layer} />
      ))}
      <Layer {...labelLayer} />
    </Source>
  );
}

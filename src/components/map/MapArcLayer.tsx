'use client';

import type { LineLayer } from 'mapbox-gl';
import { useEffect, useMemo, useRef } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/mapbox';
import { arcsToGeoJSON } from '@/lib/mapbox/arc-utils';
import { useMapStore } from '@/lib/store/map-store';

export function MapArcLayer() {
  const arcs = useMapStore((s) => s.arcs);
  const activeLayers = useMapStore((s) => s.activeLayers);
  const { current: map } = useMap();
  const animationRef = useRef<number>(0);
  const offsetRef = useRef(0);

  const geojson = useMemo(() => arcsToGeoJSON(arcs), [arcs]);

  const visible = activeLayers.has('arcs');

  // Animate dash offset
  useEffect(() => {
    if (!visible) return;

    let lastFrame = 0;
    const animate = () => {
      const now = performance.now();
      if (now - lastFrame >= 33) {
        // ~30fps
        lastFrame = now;
        offsetRef.current = (offsetRef.current + 0.3) % 6;
        const mapInstance = map?.getMap();
        if (mapInstance?.isStyleLoaded() && mapInstance.getLayer('klammer-arc-dash')) {
          const o = offsetRef.current;
          mapInstance.setPaintProperty('klammer-arc-dash', 'line-dasharray', [0, o, 4, 6 - o]);
        }
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [map, visible]);

  // Glow layer
  const glowLayer: LineLayer = {
    id: 'klammer-arc-glow',
    type: 'line',
    source: 'klammer-arcs',
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4, 10, 4, 15, 1],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.15, 10, 0.15, 15, 0.03],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 3, 10, 3, 15, 1],
    },
  };

  // Dash layer
  const dashLayer: LineLayer = {
    id: 'klammer-arc-dash',
    type: 'line',
    source: 'klammer-arcs',
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.5, 10, 1.5, 15, 0.5],
      'line-dasharray': [4, 2],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 10, 0.7, 15, 0.15],
    },
  };

  return (
    <Source id="klammer-arcs" type="geojson" data={geojson}>
      <Layer {...glowLayer} />
      <Layer {...dashLayer} />
    </Source>
  );
}

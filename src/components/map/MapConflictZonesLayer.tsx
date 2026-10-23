'use client';

import type { FillLayer, LineLayer, SymbolLayer } from 'mapbox-gl';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/mapbox';

interface Props {
  visible: boolean;
}

export function MapConflictZonesLayer({ visible }: Props) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const { current: map } = useMap();

  // Subscribe to map style lifecycle — same pattern as BUG-008 (LivestreamPanel)
  const subscribeStyle = useCallback(
    (callback: () => void) => {
      if (!map) return () => {};
      map.on('style.load', callback);
      return () => {
        map.off('style.load', callback);
      };
    },
    [map],
  );
  const styleReady = useSyncExternalStore(
    subscribeStyle,
    () => map?.isStyleLoaded() ?? false,
    () => false,
  );

  useEffect(() => {
    fetch('/data/conflict-zones.json')
      .then((r) => r.json())
      .then((data) => setGeojson(data as GeoJSON.FeatureCollection))
      .catch(() => {});
  }, []);

  if (!geojson || !styleReady) return null;

  const fillLayer: FillLayer = {
    id: 'conflict-zones-fill',
    type: 'fill',
    source: 'conflict-zones-source',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'fill-color': [
        'match',
        ['get', 'severity'],
        'critical',
        'rgba(255, 0, 64, 0.12)',
        'high',
        'rgba(255, 68, 68, 0.10)',
        'medium',
        'rgba(255, 170, 0, 0.08)',
        'rgba(255, 170, 0, 0.08)',
      ] as unknown as string,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 15, 0.2],
    },
  };

  const lineLayer: LineLayer = {
    id: 'conflict-zones-line',
    type: 'line',
    source: 'conflict-zones-source',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'line-color': [
        'match',
        ['get', 'severity'],
        'critical',
        '#ff0040',
        'high',
        '#ff4444',
        'medium',
        '#ffaa00',
        '#ffaa00',
      ] as unknown as string,
      'line-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.5],
        10,
        ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.5],
        15,
        ['case', ['boolean', ['feature-state', 'hover'], false], 0.36, 0.2],
      ] as unknown as number,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.5],
        10,
        ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.5],
        15,
        ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.6],
      ] as unknown as number,
      'line-dasharray': [4, 4],
    },
  };

  const hoverFillLayer: FillLayer = {
    id: 'conflict-zones-hover-fill',
    type: 'fill',
    source: 'conflict-zones-source',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'fill-color': [
        'match',
        ['get', 'severity'],
        'critical',
        'rgba(255, 0, 64, 0.25)',
        'high',
        'rgba(255, 68, 68, 0.20)',
        'medium',
        'rgba(255, 170, 0, 0.16)',
        'rgba(255, 170, 0, 0.16)',
      ] as unknown as string,
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        10,
        ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        15,
        ['case', ['boolean', ['feature-state', 'hover'], false], 0.2, 0],
      ] as unknown as number,
    },
  };

  const labelLayer: SymbolLayer = {
    id: 'conflict-zones-label',
    type: 'symbol',
    source: 'conflict-zones-source',
    minzoom: 5,
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': ['get', 'name'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': 10,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#ff6666',
      'text-halo-color': '#0a0a0a',
      'text-halo-width': 1,
    },
  };

  return (
    <Source id="conflict-zones-source" type="geojson" data={geojson} promoteId="id">
      <Layer {...fillLayer} />
      <Layer {...hoverFillLayer} />
      <Layer {...lineLayer} />
      <Layer {...labelLayer} />
    </Source>
  );
}

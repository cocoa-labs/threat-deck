'use client';

import type { CircleLayer, LineLayer, SymbolLayer } from 'mapbox-gl';
import { useEffect, useMemo, useState } from 'react';
import { Layer, Source } from 'react-map-gl/mapbox';

interface Props {
  visible: boolean;
}

export function MapInfrastructureLayer({ visible }: Props) {
  const [rawData, setRawData] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch('/data/infrastructure.json')
      .then((r) => r.json())
      .then((data) => setRawData(data as GeoJSON.FeatureCollection))
      .catch(() => {});
  }, []);

  // Split features by geometry type
  const { points, lines } = useMemo(() => {
    if (!rawData) return { points: null, lines: null };

    const pointFeatures = rawData.features.filter((f) => f.geometry.type === 'Point');
    const lineFeatures = rawData.features.filter((f) => f.geometry.type === 'LineString');

    return {
      points: {
        type: 'FeatureCollection' as const,
        features: pointFeatures,
      },
      lines: {
        type: 'FeatureCollection' as const,
        features: lineFeatures,
      },
    };
  }, [rawData]);

  if (!rawData) return null;

  const lineLayer: LineLayer = {
    id: 'infrastructure-lines',
    type: 'line',
    source: 'infrastructure-lines-source',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'line-color': [
        'match',
        ['get', 'category'],
        'transport',
        '#e8e8e8',
        'energy',
        '#ffaa00',
        'technology',
        '#00ff41',
        'telecom',
        '#44ff88',
        '#888888',
      ] as unknown as string,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 10, 0.5, 15, 0.1],
      'line-width': 2,
      'line-dasharray': [6, 3],
    },
  };

  const circleLayer: CircleLayer = {
    id: 'infrastructure-points',
    type: 'circle',
    source: 'infrastructure-points-source',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': [
        'match',
        ['get', 'category'],
        'transport',
        '#e8e8e8',
        'energy',
        '#ffaa00',
        'technology',
        '#00ff41',
        'telecom',
        '#44ff88',
        '#888888',
      ] as unknown as string,
      'circle-radius': ['match', ['get', 'significance'], 'critical', 5, 'high', 4, 3],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 10, 0.8, 15, 0.2],
      'circle-stroke-width': 1,
      'circle-stroke-color': [
        'match',
        ['get', 'category'],
        'transport',
        '#e8e8e8',
        'energy',
        '#ffaa00',
        'technology',
        '#00ff41',
        'telecom',
        '#44ff88',
        '#888888',
      ] as unknown as string,
      'circle-stroke-opacity': 0.3,
    },
  };

  const labelLayer: SymbolLayer = {
    id: 'infrastructure-labels',
    type: 'symbol',
    source: 'infrastructure-points-source',
    minzoom: 7,
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': ['get', 'name'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': 9,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': [
        'match',
        ['get', 'category'],
        'transport',
        '#e8e8e8',
        'energy',
        '#ffaa00',
        'technology',
        '#00ff41',
        'telecom',
        '#44ff88',
        '#888888',
      ] as unknown as string,
      'text-halo-color': '#0a0a0a',
      'text-halo-width': 1,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 15, 0.2],
    },
  };

  return (
    <>
      {lines && (
        <Source id="infrastructure-lines-source" type="geojson" data={lines}>
          <Layer {...lineLayer} />
        </Source>
      )}
      {points && (
        <Source id="infrastructure-points-source" type="geojson" data={points} promoteId="id">
          <Layer {...circleLayer} />
          <Layer {...labelLayer} />
        </Source>
      )}
    </>
  );
}

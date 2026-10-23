'use client';

import type { CircleLayer, SymbolLayer } from 'mapbox-gl';
import { useEffect, useState } from 'react';
import { Layer, Source } from 'react-map-gl/mapbox';

interface Props {
  visible: boolean;
}

export function MapMilitaryBasesLayer({ visible }: Props) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch('/data/military-bases.json')
      .then((r) => r.json())
      .then((data) => setGeojson(data as GeoJSON.FeatureCollection))
      .catch(() => {});
  }, []);

  if (!geojson) return null;

  const circleLayer: CircleLayer = {
    id: 'military-bases-circle',
    type: 'circle',
    source: 'military-bases-source',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': '#00ff88',
      'circle-radius': ['match', ['get', 'significance'], 'critical', 5, 'high', 4, 3],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 10, 0.8, 15, 0.2],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#00ff88',
      'circle-stroke-opacity': 0.3,
    },
  };

  const labelLayer: SymbolLayer = {
    id: 'military-bases-label',
    type: 'symbol',
    source: 'military-bases-source',
    minzoom: 7,
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': ['get', 'name'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': ['match', ['get', 'significance'], 'critical', 11, 'high', 10, 9],
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#00ff88',
      'text-halo-color': '#0a0a0a',
      'text-halo-width': 1,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 15, 0.2],
    },
  };

  return (
    <Source id="military-bases-source" type="geojson" data={geojson} promoteId="id">
      <Layer {...circleLayer} />
      <Layer {...labelLayer} />
    </Source>
  );
}

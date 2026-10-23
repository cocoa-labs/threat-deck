'use client';

import type { FillLayer, LineLayer } from 'mapbox-gl';
import { useEffect, useState } from 'react';
import { Layer, Source } from 'react-map-gl/mapbox';
import { getSunPosition } from '@/lib/utils/geo';

interface Props {
  visible: boolean;
}

/** Compute the terminator polygon (night side of Earth) */
function computeNightPolygon(): GeoJSON.FeatureCollection {
  const { lat: sunLat, lon: sunLon } = getSunPosition();
  const sunLatRad = (sunLat * Math.PI) / 180;

  // Build terminator line by computing latitude at each longitude
  const terminatorPoints: [number, number][] = [];

  for (let deg = -180; deg <= 180; deg += 2) {
    const dLonRad = ((deg - sunLon) * Math.PI) / 180;
    // Terminator latitude at this longitude
    const lat = Math.atan(-Math.cos(dLonRad) / Math.tan(sunLatRad)) * (180 / Math.PI);
    terminatorPoints.push([deg, lat]);
  }

  // Close the night polygon: go along the terminator, then wrap around the dark pole
  // The dark pole is the opposite of the sun's latitude
  const darkPoleLat = sunLat > 0 ? -90 : 90;

  const nightPolygonCoords: [number, number][] = [
    ...terminatorPoints,
    [180, darkPoleLat],
    [-180, darkPoleLat],
    // Close ring
    terminatorPoints[0]!,
  ];

  const terminatorLineCoords = terminatorPoints;

  return {
    type: 'FeatureCollection',
    features: [
      // Night fill polygon
      {
        type: 'Feature' as const,
        properties: { type: 'night' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [nightPolygonCoords],
        },
      },
      // Terminator line
      {
        type: 'Feature' as const,
        properties: { type: 'terminator' },
        geometry: {
          type: 'LineString' as const,
          coordinates: terminatorLineCoords,
        },
      },
    ],
  };
}

export function MapDayNightLayer({ visible }: Props) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection>(() => computeNightPolygon());

  // Recompute immediately when visibility toggles on, then update every 60s
  useEffect(() => {
    if (!visible) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- compute immediately when layer becomes visible
    setGeojson(computeNightPolygon());
    const interval = setInterval(() => {
      setGeojson(computeNightPolygon());
    }, 60_000);

    return () => clearInterval(interval);
  }, [visible]);

  const nightFillLayer: FillLayer = {
    id: 'klammer-night-fill',
    type: 'fill',
    source: 'klammer-day-night',
    filter: ['==', ['get', 'type'], 'night'],
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
    paint: {
      'fill-color': '#000000',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.15, 10, 0.15, 15, 0.03],
    },
  };

  const terminatorLineLayer: LineLayer = {
    id: 'klammer-terminator-line',
    type: 'line',
    source: 'klammer-day-night',
    filter: ['==', ['get', 'type'], 'terminator'],
    layout: {
      visibility: visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': '#00ff41',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 10, 0.3, 15, 0.05],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.5, 10, 1.5, 15, 0.5],
      'line-dasharray': [4, 4],
    },
  };

  return (
    <Source id="klammer-day-night" type="geojson" data={geojson}>
      <Layer {...nightFillLayer} />
      <Layer {...terminatorLineLayer} />
    </Source>
  );
}

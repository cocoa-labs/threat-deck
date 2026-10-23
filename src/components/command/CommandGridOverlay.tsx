'use client';

import type { LineLayer, SymbolLayer } from 'mapbox-gl';
import { useMemo } from 'react';
import { Layer, Source } from 'react-map-gl/mapbox';

/**
 * Military lat/lon grid overlay using Mapbox GeoJSON layers.
 * Lines every 15 degrees with degree labels at edges.
 * Pans and zooms with the map.
 */
export function CommandGridOverlay() {
  const { lineGeoJson, labelGeoJson } = useMemo(() => {
    const lineFeatures: GeoJSON.Feature[] = [];
    const labelFeatures: GeoJSON.Feature[] = [];

    // Latitude lines every 15 degrees (-75 to 75)
    for (let lat = -75; lat <= 75; lat += 15) {
      lineFeatures.push({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [-180, lat],
            [-90, lat],
            [0, lat],
            [90, lat],
            [180, lat],
          ],
        },
      });

      // Label at left edge
      labelFeatures.push({
        type: 'Feature',
        properties: {
          label: lat >= 0 ? `${lat}N` : `${Math.abs(lat)}S`,
        },
        geometry: {
          type: 'Point',
          coordinates: [-175, lat],
        },
      });
    }

    // Longitude lines every 15 degrees (-180 to 180)
    for (let lon = -180; lon <= 180; lon += 15) {
      lineFeatures.push({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [lon, -75],
            [lon, -37.5],
            [lon, 0],
            [lon, 37.5],
            [lon, 75],
          ],
        },
      });

      // Label at bottom edge
      if (lon > -180 && lon < 180) {
        labelFeatures.push({
          type: 'Feature',
          properties: {
            label: lon >= 0 ? `${lon}E` : `${Math.abs(lon)}W`,
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, -72],
          },
        });
      }
    }

    return {
      lineGeoJson: {
        type: 'FeatureCollection' as const,
        features: lineFeatures,
      },
      labelGeoJson: {
        type: 'FeatureCollection' as const,
        features: labelFeatures,
      },
    };
  }, []);

  const gridLineLayer: LineLayer = {
    id: 'command-grid-lines',
    type: 'line',
    source: 'command-grid',
    paint: {
      'line-color': '#00cccc',
      'line-opacity': 0.12,
      'line-width': 0.5,
      'line-dasharray': [4, 4],
    },
  };

  const gridLabelLayer: SymbolLayer = {
    id: 'command-grid-labels',
    type: 'symbol',
    source: 'command-grid-labels',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': 8,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#00cccc',
      'text-opacity': 0.35,
      'text-halo-color': '#070d1a',
      'text-halo-width': 1,
    },
  };

  return (
    <>
      <Source id="command-grid" type="geojson" data={lineGeoJson}>
        <Layer {...gridLineLayer} />
      </Source>
      <Source id="command-grid-labels" type="geojson" data={labelGeoJson}>
        <Layer {...gridLabelLayer} />
      </Source>
    </>
  );
}

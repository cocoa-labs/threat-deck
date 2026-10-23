'use client';

import type { CircleLayer, SymbolLayer } from 'mapbox-gl';
import { useEffect, useMemo, useRef } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/mapbox';
import { generateNatoSymbols } from '@/lib/command/nato-symbols';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeMarker } from '@/lib/types';
import { severityToHex } from '@/lib/utils/geo';

interface Props {
  markers: GlobeMarker[];
  visible: boolean;
}

export function CommandMarkerLayer({ markers, visible }: Props) {
  const categoryFilter = useMapStore((s) => s.categoryFilter);
  const hotspots = useMapStore((s) => s.hotspots);
  const { current: map } = useMap();
  const symbolsRegistered = useRef(false);

  // Register NATO symbol images on map load
  useEffect(() => {
    const mapInstance = map?.getMap();
    if (!mapInstance || symbolsRegistered.current) return;

    const register = () => {
      if (symbolsRegistered.current) return;
      const symbols = generateNatoSymbols();
      for (const [id, imageData] of Object.entries(symbols)) {
        if (!mapInstance.hasImage(id)) {
          mapInstance.addImage(id, imageData, { sdf: false });
        }
      }
      symbolsRegistered.current = true;
    };

    if (mapInstance.isStyleLoaded()) {
      register();
    } else {
      mapInstance.once('style.load', register);
    }

    return () => {
      symbolsRegistered.current = false;
    };
  }, [map]);

  const geojson = useMemo((): GeoJSON.FeatureCollection => {
    const filtered = categoryFilter
      ? markers.filter((m) => categoryFilter.has(m.category))
      : markers;

    return {
      type: 'FeatureCollection',
      features: filtered.map((marker) => {
        const hotspotId = marker.id.replace('hotspot-', '');
        const hotspot = hotspots.find((h) => h.id === hotspotId);

        return {
          type: 'Feature' as const,
          properties: {
            id: marker.id,
            severity: marker.severity,
            category: marker.category,
            label: marker.label,
            count: marker.count,
            source: marker.source,
            color: severityToHex(marker.severity),
            symbolId: `nato-${marker.category}`,
            description: hotspot?.description ?? marker.description ?? '',
            zoomTier: marker.zoomTier ?? 'global',
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [marker.lon, marker.lat],
          },
        };
      }),
    };
  }, [markers, categoryFilter, hotspots]);

  // ─── Zoom-tier visibility filter ───
  const tierVisibilityFilter: mapboxgl.Expression = [
    'any',
    ['==', ['get', 'zoomTier'], 'global'],
    ['all', ['>=', ['zoom'], 5], ['==', ['get', 'zoomTier'], 'country']],
    ['all', ['>=', ['zoom'], 10], ['==', ['get', 'zoomTier'], 'city']],
    ['all', ['>=', ['zoom'], 15], ['==', ['get', 'zoomTier'], 'street']],
  ] as unknown as mapboxgl.Expression;

  // ─── Cluster layers (global zoom z0-4) ───
  const clusterLayer: CircleLayer = {
    id: 'command-clusters',
    type: 'circle',
    source: 'command-markers',
    filter: ['has', 'point_count'],
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': '#003344',
      'circle-opacity': 0.7,
      'circle-radius': ['step', ['get', 'point_count'], 20, 5, 26, 10, 32, 25, 40],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#00aacc',
      'circle-stroke-opacity': 0.5,
    },
  };

  const clusterCountLayer: SymbolLayer = {
    id: 'command-cluster-count',
    type: 'symbol',
    source: 'command-markers',
    filter: ['has', 'point_count'],
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-size': 12,
    },
    paint: {
      'text-color': '#55cccc',
    },
  };

  // ─── NATO symbol icon layer with zoom-dependent sizing ───
  const symbolLayer: SymbolLayer = {
    id: 'command-nato-symbols',
    type: 'symbol',
    source: 'command-markers',
    filter: ['all', ['!', ['has', 'point_count']], tierVisibilityFilter],
    layout: {
      visibility: visible ? 'visible' : 'none',
      'icon-image': ['get', 'symbolId'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 5, 0.9, 10, 0.7, 15, 0.8],
      'icon-allow-overlap': true,
      'icon-ignore-placement': false,
      'text-field': ['get', 'label'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 8, 5, 9, 10, 10, 15, 11],
      'text-anchor': 'top',
      'text-offset': [0, 1.6],
      'text-max-width': 10,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#55cccc',
      'text-halo-color': '#070d1a',
      'text-halo-width': 1.5,
      'text-halo-blur': 0.5,
    },
  };

  return (
    <Source
      id="command-markers"
      type="geojson"
      data={geojson}
      cluster={true}
      clusterMaxZoom={4}
      clusterRadius={60}
      clusterProperties={{
        conflict_count: ['+', ['case', ['==', ['get', 'category'], 'conflict'], 1, 0]],
        economic_count: ['+', ['case', ['==', ['get', 'category'], 'economic'], 1, 0]],
        technology_count: ['+', ['case', ['==', ['get', 'category'], 'technology'], 1, 0]],
        policy_count: ['+', ['case', ['==', ['get', 'category'], 'policy'], 1, 0]],
        market_count: ['+', ['case', ['==', ['get', 'category'], 'market'], 1, 0]],
        instability_count: ['+', ['case', ['==', ['get', 'category'], 'instability'], 1, 0]],
        proliferation_count: ['+', ['case', ['==', ['get', 'category'], 'proliferation'], 1, 0]],
        strategic_count: ['+', ['case', ['==', ['get', 'category'], 'strategic'], 1, 0]],
        alternative_count: ['+', ['case', ['==', ['get', 'category'], 'alternative'], 1, 0]],
      }}
    >
      <Layer {...clusterLayer} />
      <Layer {...clusterCountLayer} />
      <Layer {...symbolLayer} />
    </Source>
  );
}

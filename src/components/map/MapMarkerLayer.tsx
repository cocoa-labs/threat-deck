'use client';

import type { CircleLayer, SymbolLayer } from 'mapbox-gl';
import { useEffect, useMemo, useRef } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/mapbox';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeMarker } from '@/lib/types';
import {
  isCyberMarker,
  markerBelongsToLayer,
  markerVisibleForActiveLayers,
} from '@/lib/utils/cyber-markers';
import { severityToHex } from '@/lib/utils/geo';

interface Props {
  markers: GlobeMarker[];
  visible: boolean;
}

export function MapMarkerLayer({ markers, visible }: Props) {
  const categoryFilter = useMapStore((s) => s.categoryFilter);
  const activeLayers = useMapStore((s) => s.activeLayers);
  const isolatedLayer = useMapStore((s) => s.isolatedLayer);
  const severityFilter = useMapStore((s) => s.severityFilter);
  // Selection + hover IDs drive paint-property highlights below. Wired so the
  // LayerIntelligenceDrawer's row hover/click produces visible feedback on the
  // matching marker — selectedMarkerId is a persistent ring until the next
  // row is clicked; hoveredMarkerId is a transient preview while the cursor
  // is over a drawer row.
  const selectedMarkerId = useMapStore((s) => s.selectedMarkerId);
  const hoveredMarkerId = useMapStore((s) => s.hoveredMarkerId);
  const { current: map } = useMap();
  const animationRef = useRef<number>(0);
  const pulseRef = useRef(0);

  const geojson = useMemo((): GeoJSON.FeatureCollection => {
    const filtered = markers.filter((marker) => {
      if (isolatedLayer && !markerBelongsToLayer(marker, isolatedLayer)) return false;
      if (severityFilter && marker.severity !== severityFilter) return false;
      if (!markerVisibleForActiveLayers(marker, activeLayers)) return false;
      if (categoryFilter && !categoryFilter.has(marker.category)) return false;
      return true;
    });

    return {
      type: 'FeatureCollection',
      features: filtered.map((marker) => {
        const cyber = isCyberMarker(marker) ? marker : null;
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
            zoomTier: marker.zoomTier ?? 'global',
            description: marker.description ?? '',
            timestamp: marker.timestamp ?? '',
            url: marker.url ?? '',
            cyberCategory: cyber?.cyberCategory ?? '',
            streamSource: cyber?.streamSource ?? '',
            kevStatus: cyber?.kevStatus ?? '',
            cvssScore: cyber?.cvssScore ?? null,
            epssScore: cyber?.epssScore ?? null,
            epssPercentile: cyber?.epssPercentile ?? null,
            referenceUrl: cyber?.referenceUrl ?? cyber?.nvdUrl ?? cyber?.mitreUrl ?? '',
            locationPrecision: cyber?.locationPrecision ?? '',
            locationConfidence: cyber?.locationConfidence ?? null,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [marker.lon, marker.lat],
          },
        };
      }),
    };
  }, [markers, categoryFilter, activeLayers, isolatedLayer, severityFilter]);

  useEffect(() => {
    if (!visible) return;

    let lastFrame = 0;
    const throttledAnimate = () => {
      const now = performance.now();
      if (now - lastFrame >= 33) {
        lastFrame = now;
        pulseRef.current = (pulseRef.current + 1) % 90;
        const t = pulseRef.current / 90;
        const pulseRadius = 8 + Math.sin(t * Math.PI * 2) * 4;

        const mapInstance = map?.getMap();
        if (mapInstance?.isStyleLoaded() && mapInstance.getLayer('klammer-pulse-ring')) {
          const zoom = mapInstance.getZoom();
          const opacityScale = zoom <= 10 ? 1.0 : Math.max(0.15, 1.0 - (zoom - 10) * 0.17);
          const pulseOpacity = (0.3 + Math.sin(t * Math.PI * 2) * 0.15) * opacityScale;
          mapInstance.setPaintProperty('klammer-pulse-ring', 'circle-radius', pulseRadius);
          mapInstance.setPaintProperty('klammer-pulse-ring', 'circle-opacity', pulseOpacity);
        }

        // Hovered-marker halo — a stronger breathing ring on the single marker
        // matched by hoveredMarkerId (set when a drawer row is hovered).
        if (mapInstance?.isStyleLoaded() && mapInstance.getLayer('klammer-hover-halo')) {
          const wave = Math.sin(t * Math.PI * 2);
          mapInstance.setPaintProperty('klammer-hover-halo', 'circle-radius', 16 + wave * 6);
          mapInstance.setPaintProperty('klammer-hover-halo', 'circle-opacity', 0.22 + wave * 0.16);
          mapInstance.setPaintProperty(
            'klammer-hover-halo',
            'circle-stroke-opacity',
            0.6 + wave * 0.3,
          );
        }
      }
      animationRef.current = requestAnimationFrame(throttledAnimate);
    };

    animationRef.current = requestAnimationFrame(throttledAnimate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [map, visible]);

  // ─── Zoom-tier filter: markers appear based on their zoomTier ───
  const zoomTierFilter = [
    'any',
    ['==', ['get', 'zoomTier'], 'global'],
    ['all', ['==', ['get', 'zoomTier'], 'country'], ['>=', ['zoom'], 5]],
    ['all', ['==', ['get', 'zoomTier'], 'city'], ['>=', ['zoom'], 10]],
    ['all', ['==', ['get', 'zoomTier'], 'street'], ['>=', ['zoom'], 15]],
  ];

  // ─── Tiered unclustered filter (not in cluster + zoom tier) ───
  const unclusteredFilter: mapboxgl.Expression = [
    'all',
    ['!', ['has', 'point_count']],
    zoomTierFilter,
  ] as unknown as mapboxgl.Expression;

  // ─── Cluster layer (active z0-9) ───
  const clusterLayer: CircleLayer = {
    id: 'klammer-clusters',
    type: 'circle',
    source: 'klammer-markers',
    filter: ['has', 'point_count'],
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': '#00ff41',
      'circle-opacity': 0.6,
      'circle-radius': ['step', ['get', 'point_count'], 16, 5, 20, 10, 26, 25, 32],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#00ff41',
      'circle-stroke-opacity': 0.3,
    },
  };

  // Cluster count label
  const clusterCountLayer: SymbolLayer = {
    id: 'klammer-cluster-count',
    type: 'symbol',
    source: 'klammer-markers',
    filter: ['has', 'point_count'],
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-size': 11,
    },
    paint: {
      'text-color': '#ffffff',
    },
  };

  // Mapbox `case` expressions used in paint properties below need a string,
  // not null. Empty string never matches a real marker id so the expression
  // safely falls through to the default branch when no marker is selected /
  // hovered.
  const selectedId = selectedMarkerId ?? '';
  const hoveredId = hoveredMarkerId ?? '';

  // ─── Pulse ring behind unclustered dots ───
  // All unclustered markers always visible — clustering handles density. The
  // selected marker also gets a brighter, less-blurred halo so the bidirectional
  // cue from the drawer reaches the eye even at small zoom.
  const pulseRingLayer: CircleLayer = {
    id: 'klammer-pulse-ring',
    type: 'circle',
    source: 'klammer-markers',
    filter: unclusteredFilter,
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 9, 5, 10, 10, 11, 15, 14],
      'circle-opacity': [
        'case',
        ['==', ['get', 'id'], selectedId],
        0.7,
        ['==', ['get', 'id'], hoveredId],
        0.5,
        0.3,
      ],
      'circle-blur': ['case', ['==', ['get', 'id'], selectedId], 0.2, 0.5],
    },
  };

  // ─── Hovered-marker halo: breathing ring on the row-hovered marker ───
  // Filter matches only the hovered id; radius/opacity are animated per-frame in
  // the rAF loop above. Sits behind the dot so it reads as a pulse emanating out.
  const hoverHaloLayer: CircleLayer = {
    id: 'klammer-hover-halo',
    type: 'circle',
    source: 'klammer-markers',
    filter: ['==', ['get', 'id'], hoveredId],
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': 16,
      'circle-opacity': 0,
      'circle-blur': 0.35,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0,
    },
  };

  // ─── Unclustered point dots with zoom-dependent sizing ───
  // All unclustered markers always visible — clustering handles density.
  // Selection: thick bright stroke + larger radius, persists across renders.
  // Hover: medium stroke + slightly larger radius, real-time preview.
  // Both are GPU-evaluated `case` expressions — no per-frame JS cost.
  const unclusteredPointLayer: CircleLayer = {
    id: 'klammer-unclustered-points',
    type: 'circle',
    source: 'klammer-markers',
    filter: unclusteredFilter,
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': ['get', 'color'],
      // Mapbox forbids a `zoom` expression anywhere but the TOP LEVEL of a
      // step/interpolate — so the old `case`-wrapping-three-interpolates shape
      // was a style-spec error (dormant only while the worker was blocked).
      // Inverted: interpolate on zoom at the top, a `case` on selected/hovered
      // in each stop output. Same radii at every stop as before.
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        ['case', ['==', ['get', 'id'], selectedId], 8, ['==', ['get', 'id'], hoveredId], 6, 5],
        5,
        ['case', ['==', ['get', 'id'], selectedId], 11, ['==', ['get', 'id'], hoveredId], 8, 7],
        10,
        ['case', ['==', ['get', 'id'], selectedId], 14, ['==', ['get', 'id'], hoveredId], 11, 9],
        15,
        ['case', ['==', ['get', 'id'], selectedId], 18, ['==', ['get', 'id'], hoveredId], 14, 12],
      ],
      'circle-opacity': 0.9,
      'circle-stroke-width': [
        'case',
        ['==', ['get', 'id'], selectedId],
        3.5,
        ['==', ['get', 'id'], hoveredId],
        2.5,
        1.5,
      ],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'id'], selectedId],
        '#ffe066', // warm yellow — pairs with the drawer's amber accent
        ['==', ['get', 'id'], hoveredId],
        '#ffffff', // cool white — preview-only state
        ['get', 'color'],
      ],
      'circle-stroke-opacity': [
        'case',
        ['==', ['get', 'id'], selectedId],
        1,
        ['==', ['get', 'id'], hoveredId],
        0.85,
        0.4,
      ],
    },
  };

  // ─── Labels: zoom-dependent detail ───
  // At global zoom (0-4): no labels (minzoom hides them)
  // At country zoom (5-9): short labels for unclustered
  // At city zoom (10-14): full labels + category badge
  // At street zoom (15+): full labels with timestamps
  const labelLayer: SymbolLayer = {
    id: 'klammer-marker-labels',
    type: 'symbol',
    source: 'klammer-markers',
    filter: unclusteredFilter,
    minzoom: 5,
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': [
        'step',
        ['zoom'],
        ['get', 'label'], // default: label only
        10,
        ['concat', ['get', 'label'], '\n', ['upcase', ['get', 'category']]],
        15,
        [
          'concat',
          ['get', 'label'],
          '\n',
          ['upcase', ['get', 'category']],
          ' · ',
          ['get', 'source'],
        ],
      ],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 10, 10, 15, 11],
      'text-anchor': 'top',
      'text-offset': [0, 1.2],
      'text-max-width': 12,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#d4d4d8',
      'text-halo-color': '#0a0a0a',
      'text-halo-width': 1.5,
      'text-halo-blur': 0.5,
    },
  };

  return (
    <Source
      id="klammer-markers"
      type="geojson"
      data={geojson}
      cluster={true}
      clusterMaxZoom={9}
      clusterRadius={50}
      clusterProperties={{
        cve_count: ['+', ['case', ['==', ['get', 'cyberCategory'], 'cve'], 1, 0]],
        breach_count: ['+', ['case', ['==', ['get', 'cyberCategory'], 'breach'], 1, 0]],
        threat_actor_count: ['+', ['case', ['==', ['get', 'cyberCategory'], 'threat_actor'], 1, 0]],
        ai_incident_count: ['+', ['case', ['==', ['get', 'cyberCategory'], 'ai_incident'], 1, 0]],
        critical_infra_count: [
          '+',
          ['case', ['==', ['get', 'cyberCategory'], 'critical_infra'], 1, 0],
        ],
        ioc_count: ['+', ['case', ['==', ['get', 'cyberCategory'], 'ioc'], 1, 0]],
        ai_safety_count: ['+', ['case', ['==', ['get', 'cyberCategory'], 'ai_safety'], 1, 0]],
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
      <Layer {...pulseRingLayer} />
      <Layer {...hoverHaloLayer} />
      <Layer {...unclusteredPointLayer} />
      <Layer {...labelLayer} />
    </Source>
  );
}

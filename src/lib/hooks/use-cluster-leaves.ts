'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-map-gl/mapbox';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeMarker } from '@/lib/types';

export interface ClusterLeavesResult {
  items: GlobeMarker[];
  loading: boolean;
  error: string | null;
}

interface FetchState {
  features: GeoJSON.Feature[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Async hook to fetch cluster leaves from the Mapbox GL source.
 * Maps GeoJSON features back to full GlobeMarker objects via ID lookup.
 */
export function useClusterLeaves(
  clusterId: number | null,
  pointCount: number,
): ClusterLeavesResult {
  const { current: mapInstance } = useMap();
  const markers = useMapStore((s) => s.markers);
  const viewMode = useMapStore((s) => s.viewMode);
  const [fetchState, setFetchState] = useState<FetchState>({
    features: null,
    loading: false,
    error: null,
  });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (clusterId == null || !mapInstance) {
      return;
    }

    const map = mapInstance.getMap();
    const sourceId = viewMode === 'command' ? 'command-markers' : 'klammer-markers';
    const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
    if (!source?.getClusterLeaves) {
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state before async callback
    setFetchState({ features: null, loading: true, error: null });

    const limit = Math.min(pointCount, 100);
    source.getClusterLeaves(
      clusterId,
      limit,
      0,
      (err?: Error | null, features?: GeoJSON.Feature[] | null) => {
        // Stale callback guard
        if (currentRequestId !== requestIdRef.current) return;

        if (err) {
          setFetchState({ features: null, loading: false, error: err.message });
          return;
        }

        setFetchState({ features: features ?? null, loading: false, error: null });
      },
    );
  }, [clusterId, pointCount, mapInstance, viewMode]);

  // Derive items from features + markers lookup (pure computation)
  const items = useMemo(() => {
    if (!fetchState.features || clusterId == null) return [];

    const markerMap = new Map(markers.map((m) => [m.id, m]));
    const resolved: GlobeMarker[] = [];
    for (const f of fetchState.features) {
      const id = f.properties?.id as string | undefined;
      if (id) {
        const marker = markerMap.get(id);
        if (marker) resolved.push(marker);
      }
    }
    return resolved;
  }, [fetchState.features, markers, clusterId]);

  if (clusterId == null) {
    return { items: [], loading: false, error: null };
  }

  return { items, loading: fetchState.loading, error: fetchState.error };
}

'use client';

import { useCallback, useMemo } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import type { GlobeLayer, GlobeMarker } from '@/lib/types';

export function useGlobeInteraction() {
  const store = useGlobeStore();

  const flyTo = useCallback(
    (lat: number, lon: number) => {
      store.flyTo(lat, lon);
    },
    [store],
  );

  const selectMarker = useCallback(
    (id: string) => {
      store.selectMarker(id);
    },
    [store],
  );

  const clearSelection = useCallback(() => {
    store.selectMarker(null);
    store.resetCamera();
  }, [store]);

  const toggleLayer = useCallback(
    (layer: GlobeLayer) => {
      store.toggleLayer(layer);
    },
    [store],
  );

  const hoveredMarker: GlobeMarker | undefined = useMemo(() => {
    if (!store.hoveredMarkerId) return undefined;
    return store.markers.find((m) => m.id === store.hoveredMarkerId);
  }, [store.hoveredMarkerId, store.markers]);

  const selectedMarker: GlobeMarker | undefined = useMemo(() => {
    if (!store.selectedMarkerId) return undefined;
    return store.markers.find((m) => m.id === store.selectedMarkerId);
  }, [store.selectedMarkerId, store.markers]);

  return {
    flyTo,
    selectMarker,
    clearSelection,
    toggleLayer,
    hoveredMarker,
    selectedMarker,
  };
}

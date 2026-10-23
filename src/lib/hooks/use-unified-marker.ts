'use client';

import { useMemo } from 'react';
import { useDataStore } from '@/lib/store/data-store';
import { useMapStore } from '@/lib/store/map-store';
import type { AgentIntelMarker, GlobeMarker, Hotspot } from '@/lib/types';

export type UnifiedMarkerResult =
  | { type: 'globe'; marker: GlobeMarker; hotspot: Hotspot | null }
  | { type: 'agent'; marker: AgentIntelMarker }
  | null;

/**
 * Unified lookup across map-store markers and data-store agent intel markers.
 * Fixes the bug where agent intel marker hover/click produces no popup.
 */
export function useUnifiedMarker(markerId: string | null): UnifiedMarkerResult {
  const markers = useMapStore((s) => s.markers);
  const hotspots = useMapStore((s) => s.hotspots);
  const agentIntelMarkers = useDataStore((s) => s.agentIntelMarkers);

  return useMemo(() => {
    if (!markerId) return null;

    // Search map-store markers first
    const globeMarker = markers.find((m) => m.id === markerId);
    if (globeMarker) {
      const hotspotId = markerId.replace('hotspot-', '');
      const hotspot = hotspots.find((h) => h.id === hotspotId) ?? null;
      return { type: 'globe', marker: globeMarker, hotspot };
    }

    // Then search data-store agent intel markers
    const agentMarker = agentIntelMarkers.find((m) => m.id === markerId);
    if (agentMarker) {
      return { type: 'agent', marker: agentMarker };
    }

    return null;
  }, [markerId, markers, hotspots, agentIntelMarkers]);
}

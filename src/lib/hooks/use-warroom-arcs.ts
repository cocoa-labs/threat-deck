'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeArc } from '@/lib/types';

async function fetchWarRoomArcs(): Promise<GlobeArc[]> {
  const res = await fetch('/api/aegis/geo-arcs?limit=60');
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: GlobeArc[] };
  return json.data ?? [];
}

/**
 * War-room arc driver. While the lens is active, fetches source→target attack
 * arcs and pushes them into BOTH arc stores (Mapbox map + R3F globe) with the
 * `arcs` layer forced on. Reuses the existing arc render + animation pipeline —
 * no new drawing code. Returns the live arc count for the lens HUD.
 */
export function useWarRoomArcs(active: boolean): number {
  const setMapArcs = useMapStore((s) => s.setArcs);
  const setGlobeArcs = useGlobeStore((s) => s.setArcs);
  const setLayerActive = useMapStore((s) => s.setLayerActive);

  const { data: arcs } = useQuery({
    queryKey: ['warroom-arcs'],
    queryFn: fetchWarRoomArcs,
    enabled: active,
    refetchInterval: active ? 120_000 : false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!active || !arcs) return;
    setMapArcs(arcs);
    setGlobeArcs(arcs);
    setLayerActive('arcs', true);
  }, [active, arcs, setMapArcs, setGlobeArcs, setLayerActive]);

  return arcs?.length ?? 0;
}

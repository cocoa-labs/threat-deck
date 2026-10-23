'use client';

import { useGlobeData } from '@/lib/hooks/use-globe-data';

/**
 * Invisible component that loads globe data (hotspots, markers, arcs)
 * into the Zustand globe store on mount.
 * Place this in the dashboard layout to ensure data is available.
 */
export function GlobeDataProvider() {
  useGlobeData();
  return null;
}

/**
 * cyber-fly — Cross-store fly-to helpers for cyber markers.
 *
 * Looks up a `CyberGlobeMarker` by its semantic id (CVE / actor / breach) in
 * the globe-store marker set and drives BOTH globe-store and map-store to
 * fly to it. Returns `true` on hit, `false` on miss so callers can fall back
 * gracefully (e.g. surface a toast).
 *
 * Lives outside the stores to avoid a globe-store → map-store import that
 * confuses TypeScript's selector type inference. Both stores are read via
 * `getState()` so this utility is callable from any event handler without
 * a React render cycle.
 */

import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';
import type { CyberGlobeMarker } from '@/lib/types';
import { isCyberMarker } from './cyber-markers';

function dispatchFly(marker: CyberGlobeMarker): true {
  // Globe — orbit camera + selection
  const globe = useGlobeStore.getState();
  globe.flyTo(marker.lat, marker.lon);
  globe.selectMarker(marker.id);

  // Map — Mapbox flyTo + selection (so the action also works in map mode).
  // `lock: true` engages the agent navigation lock — rotation stays paused
  // until the user drags or toggles. See use-auto-rotate-pause for details.
  const map = useMapStore.getState();
  map.flyTo(marker.lat, marker.lon, 4, { lock: true });
  map.selectMarker(marker.id);

  return true;
}

export function flyToActor(actorId: string): boolean {
  const markers = useGlobeStore.getState().markers;
  const m = markers.find(
    (x): x is CyberGlobeMarker => isCyberMarker(x) && x.threatActorId === actorId,
  );
  return m ? dispatchFly(m) : false;
}

export function flyToCVE(cveId: string): boolean {
  const markers = useGlobeStore.getState().markers;
  const m = markers.find((x): x is CyberGlobeMarker => isCyberMarker(x) && x.cveId === cveId);
  return m ? dispatchFly(m) : false;
}

export function flyToBreach(breachId: string): boolean {
  const markers = useGlobeStore.getState().markers;
  const m = markers.find((x): x is CyberGlobeMarker => isCyberMarker(x) && x.breachId === breachId);
  return m ? dispatchFly(m) : false;
}

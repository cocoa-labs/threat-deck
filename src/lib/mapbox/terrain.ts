import type { Map as MapboxMap } from 'mapbox-gl';

interface SourceRemovalGuard {
  guardedRemoveSource: MapboxMap['removeSource'];
  originalRemoveSource: MapboxMap['removeSource'];
  references: number;
  warned: boolean;
}

const sourceRemovalGuards = new WeakMap<MapboxMap, SourceRemovalGuard>();
const TERRAIN_SOURCE_REMOVAL_MESSAGE = "Cannot read properties of undefined (reading 'get')";

// Outdoors-v12 enables 3D terrain by default via its built-in mapbox-dem source.
// On later source removal, Mapbox _updateTerrain reads a stale sourceCache and
// crashes ("Cannot read properties of undefined (reading 'get')"). We never
// render elevation, so disable terrain after every style load.
// Idempotent — safe to call multiple times. We deliberately call
// setTerrain(null) even when getTerrain() reports null because globe/outdoors
// style swaps can leave an internal style.terrain object that still trips
// _updateTerrain during source cleanup.
export function resetMapboxTerrain(map: MapboxMap): void {
  try {
    map.setTerrain(null);
  } catch (err) {
    console.warn('[mapbox] setTerrain reset failed:', err);
  }
}

/**
 * Mapbox globe projection keeps a deferred terrain object for surface draping,
 * even after setTerrain(null). During React 19's development effect replay,
 * react-map-gl removes and recreates each declarative Source. Mapbox can remove
 * the source successfully and then throw from the follow-up _updateTerrain()
 * call before it schedules a repaint.
 *
 * Guard that one post-removal race at the Map instance boundary so every
 * react-map-gl Source benefits. All other errors are rethrown. The source must
 * already be absent and the stack must identify _updateTerrain before the error
 * is considered recoverable.
 */
export function installMapboxSourceRemovalGuard(map: MapboxMap): () => void {
  const existing = sourceRemovalGuards.get(map);
  if (existing) {
    existing.references += 1;
    return () => releaseSourceRemovalGuard(map, existing);
  }

  const originalRemoveSource = map.removeSource;
  const guard: SourceRemovalGuard = {
    originalRemoveSource,
    references: 1,
    warned: false,
    guardedRemoveSource: originalRemoveSource,
  };

  guard.guardedRemoveSource = function guardedRemoveSource(id: string) {
    try {
      return originalRemoveSource.call(map, id);
    } catch (error) {
      const isTerrainRace =
        error instanceof TypeError &&
        error.message === TERRAIN_SOURCE_REMOVAL_MESSAGE &&
        error.stack?.includes('_updateTerrain') === true;

      if (!isTerrainRace || map.getSource(id)) {
        throw error;
      }

      if (!guard.warned) {
        guard.warned = true;
        console.warn(`[mapbox] Recovered deferred-terrain cleanup after removing source "${id}".`);
      }

      map.triggerRepaint();
      return map;
    }
  };

  map.removeSource = guard.guardedRemoveSource;
  sourceRemovalGuards.set(map, guard);

  return () => releaseSourceRemovalGuard(map, guard);
}

function releaseSourceRemovalGuard(map: MapboxMap, guard: SourceRemovalGuard): void {
  guard.references -= 1;
  if (guard.references > 0) return;

  if (map.removeSource === guard.guardedRemoveSource) {
    map.removeSource = guard.originalRemoveSource;
  }
  sourceRemovalGuards.delete(map);
}

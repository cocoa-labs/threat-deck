/**
 * Tests for the agent navigation lock added to map-store. The lock is the
 * source of truth for "rotation must stay paused until the user engages",
 * read by `useAutoRotatePause` (src/lib/hooks/use-auto-rotate-pause.ts) and
 * cleared by user drag (MapAutoRotation) or sidebar toggle (AutoRotateToggle).
 *
 * map-store is created without persist middleware, but we still stub
 * localStorage defensively for parity with the agent-store test setup.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useMapStore as UseMapStore } from './map-store';

describe('map-store — navigation lock + flyTo lock option', () => {
  let useMapStore: typeof UseMapStore;

  beforeAll(async () => {
    const memoryStore = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memoryStore.set(key, value);
      },
      removeItem: (key: string) => {
        memoryStore.delete(key);
      },
      clear: () => {
        memoryStore.clear();
      },
      key: (i: number) => Array.from(memoryStore.keys())[i] ?? null,
      get length() {
        return memoryStore.size;
      },
    });

    ({ useMapStore } = await import('./map-store'));
  });

  beforeEach(() => {
    // Ensure a clean baseline. flyTo also mutates viewState/isFlying so we
    // explicitly reset the lock between tests.
    useMapStore.getState().clearNavigationLock();
  });

  it('flyTo without options leaves navigationLocked false', () => {
    useMapStore.getState().flyTo(41.88, -87.63, 8);
    expect(useMapStore.getState().navigationLocked).toBe(false);
  });

  it('flyTo with { lock: false } leaves navigationLocked false', () => {
    useMapStore.getState().flyTo(41.88, -87.63, 8, { lock: false });
    expect(useMapStore.getState().navigationLocked).toBe(false);
  });

  it('flyTo with { lock: true } sets navigationLocked true', () => {
    useMapStore.getState().flyTo(41.88, -87.63, 16, { lock: true });
    expect(useMapStore.getState().navigationLocked).toBe(true);
  });

  it('clearNavigationLock resets the flag', () => {
    useMapStore.getState().flyTo(41.88, -87.63, 16, { lock: true });
    expect(useMapStore.getState().navigationLocked).toBe(true);
    useMapStore.getState().clearNavigationLock();
    expect(useMapStore.getState().navigationLocked).toBe(false);
  });

  it('flyTo always sets isFlying true regardless of lock option', () => {
    useMapStore.getState().flyTo(0, 0);
    expect(useMapStore.getState().isFlying).toBe(true);

    useMapStore.getState().clearNavigationLock();
    useMapStore.getState().flyTo(0, 0, undefined, { lock: true });
    expect(useMapStore.getState().isFlying).toBe(true);
  });

  it('flyTo updates viewState to the target', () => {
    useMapStore.getState().flyTo(41.88, -87.63, 16, { lock: true });
    const vs = useMapStore.getState().viewState;
    expect(vs.latitude).toBe(41.88);
    expect(vs.longitude).toBe(-87.63);
    expect(vs.zoom).toBe(16);
  });

  it('clearNavigationLock without a prior lock is a safe no-op', () => {
    useMapStore.getState().clearNavigationLock();
    expect(useMapStore.getState().navigationLocked).toBe(false);
  });
});

/**
 * Tests for the LAYER INTELLIGENCE drawer state added for the row-anchored flyout:
 * - hoverMarker now carries a source ('map' | 'list') so MapMarkerOverlay can
 *   suppress its marker-anchored card when the hover came from a drawer row.
 * - severityFilter narrows the drawer list + globe markers to one severity.
 * - isolatedLayer + severityFilter must auto-clear on close / view-mode change /
 *   reset / layer switch so the globe can never be left silently filtered.
 */
describe('map-store — hover source + severity filter + isolate auto-clear', () => {
  let useMapStore: typeof UseMapStore;

  beforeAll(async () => {
    ({ useMapStore } = await import('./map-store'));
  });

  beforeEach(() => {
    const s = useMapStore.getState();
    s.hoverMarker(null);
    s.setIsolatedLayer(null);
    s.setSeverityFilter(null);
    s.closeLayerDrawer();
    s.setViewMode('map');
  });

  it('hoverMarker(id) defaults hoverSource to "map"', () => {
    useMapStore.getState().hoverMarker('marker-1');
    expect(useMapStore.getState().hoveredMarkerId).toBe('marker-1');
    expect(useMapStore.getState().hoverSource).toBe('map');
  });

  it('hoverMarker(id, "list") tags the hover as coming from a drawer row', () => {
    useMapStore.getState().hoverMarker('marker-1', 'list');
    expect(useMapStore.getState().hoverSource).toBe('list');
  });

  it('hoverMarker(null) clears both the id and the source', () => {
    useMapStore.getState().hoverMarker('marker-1', 'list');
    useMapStore.getState().hoverMarker(null);
    expect(useMapStore.getState().hoveredMarkerId).toBeNull();
    expect(useMapStore.getState().hoverSource).toBeNull();
  });

  it('setSeverityFilter sets and clears the severity', () => {
    useMapStore.getState().setSeverityFilter('critical');
    expect(useMapStore.getState().severityFilter).toBe('critical');
    useMapStore.getState().setSeverityFilter(null);
    expect(useMapStore.getState().severityFilter).toBeNull();
  });

  it('closeLayerDrawer clears isolatedLayer + severityFilter', () => {
    const s = useMapStore.getState();
    s.openLayerDrawer('cyberCVEs');
    s.setIsolatedLayer('cyberCVEs');
    s.setSeverityFilter('high');
    s.closeLayerDrawer();
    expect(useMapStore.getState().layerDrawerOpen).toBe(false);
    expect(useMapStore.getState().isolatedLayer).toBeNull();
    expect(useMapStore.getState().severityFilter).toBeNull();
  });

  it('setViewMode away from map clears isolatedLayer + severityFilter', () => {
    const s = useMapStore.getState();
    s.setIsolatedLayer('cyberCVEs');
    s.setSeverityFilter('high');
    s.setViewMode('globe');
    expect(useMapStore.getState().isolatedLayer).toBeNull();
    expect(useMapStore.getState().severityFilter).toBeNull();
  });

  it('resetView clears isolatedLayer + severityFilter', () => {
    const s = useMapStore.getState();
    s.setIsolatedLayer('cyberCVEs');
    s.setSeverityFilter('high');
    s.resetView();
    expect(useMapStore.getState().isolatedLayer).toBeNull();
    expect(useMapStore.getState().severityFilter).toBeNull();
  });

  it('openLayerDrawer for a DIFFERENT layer clears stale isolation/severity', () => {
    const s = useMapStore.getState();
    s.openLayerDrawer('cyberCVEs');
    s.setIsolatedLayer('cyberCVEs');
    s.setSeverityFilter('high');
    s.openLayerDrawer('cyberBreaches');
    expect(useMapStore.getState().activeLayerDrawer).toBe('cyberBreaches');
    expect(useMapStore.getState().isolatedLayer).toBeNull();
    expect(useMapStore.getState().severityFilter).toBeNull();
  });

  it('openLayerDrawer for the SAME layer preserves its isolation', () => {
    const s = useMapStore.getState();
    s.openLayerDrawer('cyberCVEs');
    s.setIsolatedLayer('cyberCVEs');
    s.openLayerDrawer('cyberCVEs');
    expect(useMapStore.getState().isolatedLayer).toBe('cyberCVEs');
  });
});

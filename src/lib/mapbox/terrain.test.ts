import type { Map as MapboxMap } from 'mapbox-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMapboxSourceRemovalGuard } from './terrain';

interface FakeMapControls {
  map: MapboxMap;
  originalRemoveSource: MapboxMap['removeSource'];
  repaint: ReturnType<typeof vi.fn>;
  sources: Set<string>;
}

function makeFakeMap(
  removeSource: (this: MapboxMap, id: string, sources: Set<string>) => MapboxMap,
): FakeMapControls {
  const sources = new Set(['overlay']);
  const repaint = vi.fn();
  const map = {
    getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
    triggerRepaint: repaint,
  } as unknown as MapboxMap;
  const originalRemoveSource = vi.fn(function original(this: MapboxMap, id: string) {
    return removeSource.call(this, id, sources);
  }) as unknown as MapboxMap['removeSource'];
  map.removeSource = originalRemoveSource;
  return { map, originalRemoveSource, repaint, sources };
}

function terrainRace(): TypeError {
  const error = new TypeError("Cannot read properties of undefined (reading 'get')");
  error.stack = `TypeError: ${error.message}
    at Terrain.update
    at Painter.updateTerrain
    at Map._updateTerrain`;
  return error;
}

describe('installMapboxSourceRemovalGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates successful removals and restores the original method', () => {
    const { map, originalRemoveSource, sources } = makeFakeMap(function remove(id, current) {
      current.delete(id);
      return this;
    });

    const release = installMapboxSourceRemovalGuard(map);
    expect(map.removeSource('overlay')).toBe(map);
    expect(originalRemoveSource).toHaveBeenCalledWith('overlay');
    expect(sources.has('overlay')).toBe(false);

    release();
    expect(map.removeSource).toBe(originalRemoveSource);
  });

  it('recovers only when Mapbox removed the source before _updateTerrain threw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { map, repaint } = makeFakeMap((_id, sources) => {
      sources.delete('overlay');
      throw terrainRace();
    });

    const release = installMapboxSourceRemovalGuard(map);
    expect(map.removeSource('overlay')).toBe(map);
    expect(repaint).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    release();
  });

  it('rethrows the terrain error when the source is still present', () => {
    const { map, repaint } = makeFakeMap(() => {
      throw terrainRace();
    });

    const release = installMapboxSourceRemovalGuard(map);
    expect(() => map.removeSource('overlay')).toThrow(terrainRace().message);
    expect(repaint).not.toHaveBeenCalled();
    release();
  });

  it('rethrows unrelated source-removal failures', () => {
    const { map, repaint } = makeFakeMap((_id, sources) => {
      sources.delete('overlay');
      throw new TypeError("Cannot read properties of undefined (reading 'get')");
    });

    const release = installMapboxSourceRemovalGuard(map);
    expect(() => map.removeSource('overlay')).toThrow(
      "Cannot read properties of undefined (reading 'get')",
    );
    expect(repaint).not.toHaveBeenCalled();
    release();
  });

  it('reference-counts repeated installation on the same map', () => {
    const { map, originalRemoveSource } = makeFakeMap(function remove() {
      return this;
    });

    const releaseFirst = installMapboxSourceRemovalGuard(map);
    const guardedRemoveSource = map.removeSource;
    const releaseSecond = installMapboxSourceRemovalGuard(map);
    expect(map.removeSource).toBe(guardedRemoveSource);

    releaseFirst();
    expect(map.removeSource).toBe(guardedRemoveSource);
    releaseSecond();
    expect(map.removeSource).toBe(originalRemoveSource);
  });
});

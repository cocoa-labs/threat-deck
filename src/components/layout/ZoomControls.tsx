'use client';

import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useCallback } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';

const MAP_MIN_ZOOM = 1;
const MAP_MAX_ZOOM = 18;
const COMMAND_MIN_ZOOM = 0.5;

export function ZoomControls() {
  const viewMode = useMapStore((s) => s.viewMode);
  const viewState = useMapStore((s) => s.viewState);
  const setViewState = useMapStore((s) => s.setViewState);
  const resetView = useMapStore((s) => s.resetView);
  const clearNavigationLock = useMapStore((s) => s.clearNavigationLock);
  const resetCamera = useGlobeStore((s) => s.resetCamera);
  const requestGlobeZoom = useGlobeStore((s) => s.requestGlobeZoom);

  const handleZoomIn = useCallback(() => {
    if (viewMode === 'globe') {
      requestGlobeZoom('in');
    } else {
      const maxZoom = MAP_MAX_ZOOM;
      const newZoom = Math.min(maxZoom, viewState.zoom + 1);
      setViewState({ ...viewState, zoom: newZoom });
    }
  }, [viewMode, viewState, setViewState, requestGlobeZoom]);

  const handleZoomOut = useCallback(() => {
    if (viewMode === 'globe') {
      requestGlobeZoom('out');
    } else {
      const minZoom = viewMode === 'command' ? COMMAND_MIN_ZOOM : MAP_MIN_ZOOM;
      const newZoom = Math.max(minZoom, viewState.zoom - 1);
      setViewState({ ...viewState, zoom: newZoom });
    }
  }, [viewMode, viewState, setViewState, requestGlobeZoom]);

  const handleReset = useCallback(() => {
    // The reset button is universally a "user is taking control, go back to
    // default" gesture — release any agent navigation lock. For the Mapbox
    // path, resetView() also clears it (defense in depth); for the R3F path,
    // globe-store's resetCamera doesn't touch map-store, so we clear here.
    clearNavigationLock();
    if (viewMode === 'globe') {
      resetCamera();
      requestGlobeZoom('reset');
    } else {
      resetView();
    }
    // Signal MapAutoRotation to treat this as a clean-slate "resume now"
    // gesture. It cancels any racing easeTo, clears the hover/interaction
    // pause refs that the click-on-reset-button would otherwise leave true
    // (cursor is still over the map), and kicks spinStep on the next frame.
    // Dispatched at window scope so MapAutoRotation can pick it up via a
    // global listener without needing a ref or context bridge.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('threatdeck:reset-rotation'));
    }
  }, [viewMode, resetView, resetCamera, requestGlobeZoom, clearNavigationLock]);

  const btnClass =
    'flex h-7 w-7 items-center justify-center rounded bg-[#0d0d0d]/80 text-[var(--text-dim)] backdrop-blur-sm border border-white/5 hover:text-[var(--crt-glow)] hover:border-[rgba(var(--crt-glow-rgb),0.3)]';

  return (
    <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-1">
      <button
        type="button"
        onClick={handleZoomIn}
        className={btnClass}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <Plus size={13} />
      </button>
      <button
        type="button"
        onClick={handleReset}
        className={btnClass}
        aria-label="Reset view"
        title="Reset view"
      >
        <RotateCcw size={13} />
      </button>
      <button
        type="button"
        onClick={handleZoomOut}
        className={btnClass}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <Minus size={13} />
      </button>
    </div>
  );
}

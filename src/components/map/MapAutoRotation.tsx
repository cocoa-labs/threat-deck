'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/mapbox';
import { useAutoRotatePause } from '@/lib/hooks/use-auto-rotate-pause';
import { useMapStore } from '@/lib/store/map-store';

/**
 * Spec from the approved plan §Spec:
 *   - 90 s per revolution = 4 °/s
 *   - west-to-east apparent drift = increment longitude
 *   - instant stop, smooth ease-in on resume
 *
 * Implementation note: we use the canonical Mapbox "spin globe" pattern —
 * chained `easeTo` calls on `moveend`, NOT per-frame `jumpTo`. The chained
 * approach plays nicely with react-map-gl's controlled mode (one prop update
 * per second instead of per-frame thrash) and is the pattern from Mapbox's
 * own globe-spin example. Instant stop is achieved via `map.stop()`.
 */
const SECONDS_PER_REVOLUTION = 90;
const STEP_DURATION_MS = 1000; // one easeTo step = 1 second
const STEP_DISTANCE_DEG = 360 / SECONDS_PER_REVOLUTION; // 4° per second

function isEligibleState(state: ReturnType<typeof useMapStore.getState>): boolean {
  // Active only on the GEO hero tab AND when the Mapbox map is the surface.
  // R3F globe (viewMode='globe') has its own controller in GlobeControls.tsx.
  // Command view doesn't rotate.
  return state.viewMode === 'map' && state.heroTab === 'geo';
}

/**
 * Mapbox child component that drives the slow auto-rotation of the Mapbox
 * globe. Mount as a child of `<MapGL>` in MapCanvas; renders no DOM.
 *
 * Tears down its listeners entirely when the user is not on the GEO tab with
 * `viewMode='map'` — no background work outside that mode.
 */
export function MapAutoRotation() {
  const { current: mapRef } = useMap();

  // Caller-owned pause refs fed into the shared pause hook.
  const hoverPausedRef = useRef(false);
  const interactionPausedRef = useRef(false);
  const isFlyingRef = useRef(false);

  // Stable ref containers — the actual functions are wired below in the
  // effect, but useAutoRotatePause's onResume callback needs a stable wrapper.
  const kickSpinRef = useRef<() => void>(() => {});

  const { shouldRotateRef, prefersReducedMotionRef, recompute } = useAutoRotatePause({
    hoverPausedRef,
    interactionPausedRef,
    isFlyingRef,
    onResume: () => kickSpinRef.current(),
  });

  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();
    if (!map) return;

    let cleanupActive: (() => void) | null = null;
    let animating = false;

    const teardownActive = () => {
      animating = false;
      try {
        map.stop();
      } catch {
        // map may already be torn down; ignore
      }
      cleanupActive?.();
      cleanupActive = null;
      hoverPausedRef.current = false;
      interactionPausedRef.current = false;
    };

    const spinStep = () => {
      if (!shouldRotateRef.current || prefersReducedMotionRef.current) {
        animating = false;
        return;
      }
      const c = map.getCenter();
      animating = true;
      map.easeTo({
        center: [c.lng + STEP_DISTANCE_DEG, c.lat],
        duration: STEP_DURATION_MS,
        easing: (n) => n, // linear so chained steps look continuous
      });
    };

    // Expose spinStep to the pause hook's onResume callback (set during render
    // before this effect runs). The wrapper guards against starting a second
    // animation when one is already in flight.
    //
    // We defer the actual spinStep to the next animation frame so React's
    // render + react-map-gl's controlled-mode prop sync can settle before
    // our easeTo starts. Without this defer, when a pause source clears
    // synchronously inside a store subscriber (e.g. on reset), spinStep
    // would start an easeTo from the map's CURRENT position — which is the
    // pre-jump location, since react-map-gl applies new viewState on a
    // subsequent commit. The chained loop would then race the controlled-
    // mode jumpTo and get stuck.
    kickSpinRef.current = () => {
      if (!cleanupActive) return;
      if (animating) return;
      if (!shouldRotateRef.current || prefersReducedMotionRef.current) return;
      requestAnimationFrame(() => {
        if (!cleanupActive) return;
        if (animating) return;
        if (!shouldRotateRef.current || prefersReducedMotionRef.current) return;
        spinStep();
      });
    };

    const setupActive = () => {
      if (cleanupActive) return;

      const container = map.getContainer();

      // ─── Hover detection ───
      // Hovering pauses rotation but does NOT cancel the in-flight easeTo —
      // calling map.stop() here was racing with Mapbox's own mousedown
      // handling and leaving the map in a state where subsequent dragPan
      // gestures would fail to register. Instead, we let the current 1-second
      // easeTo finish naturally; the moveend gate then skips re-chaining
      // while paused.
      const handlePointerEnter = () => {
        hoverPausedRef.current = true;
        recompute();
      };
      const handlePointerLeave = () => {
        hoverPausedRef.current = false;
        recompute(); // onResume → kickSpinRef → spinStep
      };
      container.addEventListener('pointerenter', handlePointerEnter);
      container.addEventListener('pointerleave', handlePointerLeave);

      // ─── User interaction via plain mousedown/mouseup ───
      // This is the canonical Mapbox globe-spin pattern. We DON'T touch
      // map.stop() or any Mapbox-internal animation state — Mapbox handles
      // animation cancellation itself when the user mousedowns. Our job is
      // just to set `interactionPausedRef` so our moveend handler skips
      // re-chaining the next spin step while the user is interacting.
      //
      // mouseup listens on `window` so a release outside the canvas (after
      // dragging off-screen) still clears the flag. The 400 ms timer lets
      // Mapbox's drag inertia (~300 ms) settle before our spin resumes.
      let interactionUnpauseTimer: ReturnType<typeof setTimeout> | null = null;
      const handleMouseDown = () => {
        if (interactionUnpauseTimer) {
          clearTimeout(interactionUnpauseTimer);
          interactionUnpauseTimer = null;
        }
        interactionPausedRef.current = true;
        recompute();
      };
      const handleMouseUp = () => {
        if (interactionUnpauseTimer) clearTimeout(interactionUnpauseTimer);
        interactionUnpauseTimer = setTimeout(() => {
          interactionUnpauseTimer = null;
          interactionPausedRef.current = false;
          recompute(); // onResume → kickSpinRef → spinStep
        }, 400);
      };
      container.addEventListener('mousedown', handleMouseDown);
      container.addEventListener('touchstart', handleMouseDown, { passive: true });
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchend', handleMouseUp);

      // moveend: chain the next spinStep when the previous one completes,
      // IF we're allowed to rotate. While interactionPausedRef or
      // hoverPausedRef is true, this gate skips and animating goes false —
      // the map settles and the user has unimpeded drag.
      const handleMoveEnd = () => {
        if (shouldRotateRef.current && !prefersReducedMotionRef.current && cleanupActive) {
          spinStep();
        } else {
          animating = false;
        }
      };
      map.on('moveend', handleMoveEnd);

      // dragend: Mapbox fires this only at the end of a real user drag (past
      // its dragPan threshold), so it's the cleanest signal that the user has
      // engaged with the map and is no longer deferring to Max's last `flyTo`
      // target. Release the navigation lock here. The hover/interaction pause
      // already handles the rotation pause during the drag itself.
      const handleDragEnd = (e: { originalEvent?: Event }) => {
        if (e.originalEvent) {
          useMapStore.getState().clearNavigationLock();
        }
      };
      map.on('dragend', handleDragEnd);

      // isFlying mirror.
      // When isFlying transitions TRUE (the agent or any other caller invoked
      // `store.flyTo`), we MUST cancel our in-flight spinStep easeTo right
      // away. Otherwise the rotation easeTo continues to fire move events
      // through Mapbox's onMove → handleMove → setViewState callback, and
      // each frame overwrites the just-set target viewState with the current
      // spin position — fighting the agent's destination to a standstill.
      isFlyingRef.current = useMapStore.getState().isFlying;
      const unsubFlying = useMapStore.subscribe((state, prev) => {
        if (state.isFlying !== prev.isFlying) {
          isFlyingRef.current = state.isFlying;
          recompute();
          if (state.isFlying) {
            try {
              map.stop();
            } catch {
              // map may already be torn down; ignore
            }
            animating = false;
          }
        }
      });

      // ─── Reset signal ───
      // The reset button (ZoomControls) dispatches this when the user clicks
      // it. Reset is an explicit "I'm taking control, go home and start
      // rotating again" gesture — but our normal pause sources (hover from
      // the cursor still being over the map, the 400ms mouseup settle timer
      // from the click) would otherwise keep rotation paused until the user
      // moves the cursor off. This handler treats reset as a full clean
      // slate: cancel any stale easeTo, clear transient pause refs, and kick
      // spinStep on the next frame (after react-map-gl has applied the
      // resetView viewState).
      const handleResetSignal = () => {
        try {
          map.stop();
        } catch {
          // map may already be torn down; ignore
        }
        animating = false;
        hoverPausedRef.current = false;
        interactionPausedRef.current = false;
        if (interactionUnpauseTimer) {
          clearTimeout(interactionUnpauseTimer);
          interactionUnpauseTimer = null;
        }
        recompute();
        // kickSpinRef internally rAFs the spinStep, so timing is naturally
        // deferred until after react-map-gl's controlled-mode sync.
        kickSpinRef.current();
      };
      window.addEventListener('threatdeck:reset-rotation', handleResetSignal);

      cleanupActive = () => {
        container.removeEventListener('pointerenter', handlePointerEnter);
        container.removeEventListener('pointerleave', handlePointerLeave);
        container.removeEventListener('mousedown', handleMouseDown);
        container.removeEventListener('touchstart', handleMouseDown);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchend', handleMouseUp);
        window.removeEventListener('threatdeck:reset-rotation', handleResetSignal);
        map.off('moveend', handleMoveEnd);
        map.off('dragend', handleDragEnd);
        unsubFlying();
        if (interactionUnpauseTimer) {
          clearTimeout(interactionUnpauseTimer);
          interactionUnpauseTimer = null;
        }
      };

      // Kick off the first spin step now that everything is wired.
      recompute();
      if (shouldRotateRef.current && !prefersReducedMotionRef.current) {
        spinStep();
      }
    };

    // Initial activation if currently eligible.
    if (isEligibleState(useMapStore.getState())) {
      setupActive();
    }

    // Watch for eligibility transitions for the lifetime of this effect.
    const unsubGate = useMapStore.subscribe((state, prev) => {
      const next = isEligibleState(state);
      const was = isEligibleState(prev);
      if (next === was) return;
      if (next) setupActive();
      else teardownActive();
    });

    return () => {
      unsubGate();
      teardownActive();
      kickSpinRef.current = () => {};
    };
  }, [mapRef, shouldRotateRef, prefersReducedMotionRef, recompute]);

  return null;
}

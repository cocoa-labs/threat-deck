'use client';

import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useAgentStore } from '@/lib/store/agent-store';
import { useDataStore } from '@/lib/store/data-store';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';

/**
 * Zoom level above which the Mapbox globe stops rotating. Globe view sits at
 * zoom 1–3; 4 is roughly continent. Above that we're at country/state/city
 * level and rotation would drift the user off whatever they're inspecting.
 * Matches the canonical Mapbox `maxSpinZoom` pattern from their official
 * globe-spin example.
 */
export const ROTATION_MAX_ZOOM = 4;

/**
 * Window during which an autonomous toast holds the globe still so the user
 * can read the alert without competing motion. Counts from the moment a new
 * `autonomousResults` entry appears.
 */
export const AUTONOMOUS_TOAST_PAUSE_MS = 8000;

/**
 * Length of the speed ramp when rotation resumes (false → true transition of
 * `shouldRotate`). Speed multiplier goes linearly from 0 to 1 over this many
 * milliseconds. Stops are instant (no ramp-down).
 */
export const AUTO_ROTATE_RAMP_MS = 400;

interface UseAutoRotatePauseArgs {
  /** Cursor over the map/globe container — caller flips this from pointerenter/leave. */
  hoverPausedRef: RefObject<boolean>;
  /** User is actively dragging/zooming — caller flips this from movestart/moveend or OrbitControls.onStart/onEnd. */
  interactionPausedRef: RefObject<boolean>;
  /** Mirrors map-store or globe-store `isFlying`. Caller is responsible for subscribing. */
  isFlyingRef: RefObject<boolean>;
  /**
   * Fired synchronously when `shouldRotate` transitions false → true (any pause
   * source clears AND no other pause source is active). Use to kick a chained
   * animation loop back to life. Not called for the initial transition that
   * happens during the hook's own setup — caller initiates from there.
   */
  onResume?: () => void;
}

interface UseAutoRotatePauseResult {
  /** True when ALL pause sources are clear. Read inside a RAF loop. */
  shouldRotateRef: RefObject<boolean>;
  /** `performance.now()` of the most recent false → true transition. Used by callers to compute the speed ramp factor: `min((now - rampStart) / RAMP_MS, 1)`. */
  rampStartTimeRef: RefObject<number>;
  /** True if `(prefers-reduced-motion: reduce)` matches. Callers can skip all rotation work entirely if this is set. */
  prefersReducedMotionRef: RefObject<boolean>;
  /** Stable-identity recompute. Call from event handlers after flipping caller-supplied refs (hover, interaction, isFlying). */
  recompute: () => void;
}

/**
 * Consolidates the pause sources for hero-globe auto-rotation into a single
 * `shouldRotateRef` boolean. Both the Mapbox `MapAutoRotation` and the R3F
 * `GlobeControls` consume this hook so their behavior stays in lockstep.
 *
 * Pause sources:
 *  1. `prefers-reduced-motion: reduce` (also disables the UI toggle)
 *  2. `autoRotateEnabled = false` in globe-store
 *  3. Cursor hover over the map/globe container (caller-supplied ref)
 *  4. Browser tab hidden / window blurred (managed here)
 *  5. User actively drag/pan/zoom (caller-supplied ref)
 *  6. `isFlying === true` (caller-supplied ref)
 *  7. Autonomous toast appeared within the last 8s (managed here)
 *  8. Agent navigation lock — `map-store.navigationLocked` set after explicit
 *     `flyTo(..., { lock: true })`. Released by user drag or toggle click.
 *  9. Map zoom > `ROTATION_MAX_ZOOM` (Mapbox only; R3F globe ignores it).
 *
 * NOTE: Max-drawer-open is intentionally NOT a pause source. The user wants
 * ambient rotation to continue during a Max conversation; only hover-over-
 * the-globe should pause it. The `agent-store.drawerOpen` field stays — it
 * drives drawer mount/visibility — we just don't consult it here.
 *
 * NOTE: `markersPresentRef` is also not gated (see the comment inside the
 * AND-chain): markers don't have a reliable cleanup path and would
 * indefinitely pin rotation off; they ride the rotation instead.
 *
 * All state lives in refs to keep the recompute path synchronous from the
 * DOM event that triggered it — no React re-renders between "user moved
 * mouse" and "rotation paused this frame".
 */
export function useAutoRotatePause({
  hoverPausedRef,
  interactionPausedRef,
  isFlyingRef,
  onResume,
}: UseAutoRotatePauseArgs): UseAutoRotatePauseResult {
  // Internally-managed pause sources.
  const prefersReducedMotionRef = useRef(false);
  const autoRotateEnabledRef = useRef(true);
  const toastPausedRef = useRef(false);
  const pageHiddenRef = useRef(false);
  const navigationLockedRef = useRef(false);
  const zoomTooDeepRef = useRef(false);
  const markersPresentRef = useRef(false);

  // Output refs.
  const shouldRotateRef = useRef(false);
  const rampStartTimeRef = useRef(0);

  // Mirror onResume into a ref so the recompute closure always reads the
  // latest callback without invalidating useEffect.
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  // Internal recompute holder — set by useEffect, called via stable `recompute`.
  const recomputeRef = useRef<() => void>(() => {});

  // Stable-identity recompute exposed to callers. Each call dispatches through
  // recomputeRef.current so the latest closure (with current ref reads) runs.
  const recompute = useCallback(() => {
    recomputeRef.current();
  }, []);

  useEffect(() => {
    let initialized = false;
    const doRecompute = () => {
      // NOTE: `markersPresentRef` is intentionally NOT in this AND-chain.
      // Agent-placed markers (attentionPulses + agentIntelMarkers) don't have
      // a reliable cleanup pathway in practice — they accumulate over a
      // session and never reach 0, which permanently gates rotation off.
      // Mapbox's own globe-spin example doesn't pause for markers either;
      // they ride the rotation anchored to lat/lon. If a user wants to
      // inspect a marker they'll hover the globe and the hover-pause kicks
      // in naturally. The subscriber still updates the ref for diagnostics.
      const next =
        !prefersReducedMotionRef.current &&
        autoRotateEnabledRef.current &&
        !hoverPausedRef.current &&
        !pageHiddenRef.current &&
        !interactionPausedRef.current &&
        !isFlyingRef.current &&
        !toastPausedRef.current &&
        !navigationLockedRef.current &&
        !zoomTooDeepRef.current;

      const wasRotating = shouldRotateRef.current;
      if (next && !wasRotating) {
        rampStartTimeRef.current = performance.now();
      }
      shouldRotateRef.current = next;

      // Fire onResume on false → true transitions, but skip the very first
      // call (the bootstrap recompute below). Callers do their own kick-off.
      if (initialized && next && !wasRotating) {
        onResumeRef.current?.();
      }
    };
    recomputeRef.current = doRecompute;

    // ─── prefers-reduced-motion ───
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotionRef.current = mql.matches;
    const handleMotionChange = (ev: MediaQueryListEvent) => {
      prefersReducedMotionRef.current = ev.matches;
      doRecompute();
    };
    mql.addEventListener('change', handleMotionChange);

    // ─── Page visibility ───
    // Use visibilityState only (not document.hasFocus()) — hasFocus returns
    // false when devtools take focus, which would inappropriately pause an
    // ambient animation while the developer is just inspecting.
    const computeHidden = (): boolean => document.visibilityState !== 'visible';
    pageHiddenRef.current = computeHidden();
    const handleVisibility = () => {
      const next = computeHidden();
      if (next !== pageHiddenRef.current) {
        pageHiddenRef.current = next;
        doRecompute();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ─── globe-store: autoRotateEnabled ───
    autoRotateEnabledRef.current = useGlobeStore.getState().autoRotateEnabled;
    const unsubGlobe = useGlobeStore.subscribe((state, prev) => {
      if (state.autoRotateEnabled !== prev.autoRotateEnabled) {
        autoRotateEnabledRef.current = state.autoRotateEnabled;
        doRecompute();
      }
    });

    // ─── map-store + data-store: navigation lock, zoom gate, markers ───
    // Counters live in the outer scope so both subscribers (and the shared
    // recompute below) can read them.
    const initialMap = useMapStore.getState();
    navigationLockedRef.current = initialMap.navigationLocked;
    zoomTooDeepRef.current = initialMap.viewState.zoom > ROTATION_MAX_ZOOM;
    let lastPulseCount = initialMap.attentionPulses.length;
    let lastIntelCount = useDataStore.getState().agentIntelMarkers.length;
    const recomputeMarkersPresent = () => {
      const present = lastPulseCount > 0 || lastIntelCount > 0;
      if (present === markersPresentRef.current) return false;
      markersPresentRef.current = present;
      return true;
    };
    markersPresentRef.current = lastPulseCount > 0 || lastIntelCount > 0;

    const unsubMap = useMapStore.subscribe((state, prev) => {
      let changed = false;

      if (state.navigationLocked !== prev.navigationLocked) {
        navigationLockedRef.current = state.navigationLocked;
        changed = true;
      }

      // Zoom delta only — otherwise the longitude nudge each spin frame would
      // fire this subscriber on every tick.
      if (state.viewState.zoom !== prev.viewState.zoom) {
        const tooDeep = state.viewState.zoom > ROTATION_MAX_ZOOM;
        if (tooDeep !== zoomTooDeepRef.current) {
          zoomTooDeepRef.current = tooDeep;
          changed = true;
        }
      }

      // Attention pulses array reference changes on add/remove only.
      if (state.attentionPulses !== prev.attentionPulses) {
        const pulseCount = state.attentionPulses.length;
        if (pulseCount !== lastPulseCount) {
          lastPulseCount = pulseCount;
          if (recomputeMarkersPresent()) changed = true;
        }
      }

      if (changed) doRecompute();
    });

    const unsubData = useDataStore.subscribe((state, prev) => {
      if (state.agentIntelMarkers !== prev.agentIntelMarkers) {
        const intelCount = state.agentIntelMarkers.length;
        if (intelCount !== lastIntelCount) {
          lastIntelCount = intelCount;
          if (recomputeMarkersPresent()) doRecompute();
        }
      }
    });

    // ─── agent-store: autonomousResults (8s toast pause only) ───
    // Drawer-open is intentionally NOT subscribed here. See the file-level
    // JSDoc — rotation continues during Max conversations.
    const initialAgent = useAgentStore.getState();
    let lastResultId = initialAgent.autonomousResults[0]?.id ?? null;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubAgent = useAgentStore.subscribe((state, prev) => {
      // Detect a new autonomous result (newest entry has a different id).
      const newestId = state.autonomousResults[0]?.id ?? null;
      if (newestId && newestId !== prev.autonomousResults[0]?.id && newestId !== lastResultId) {
        lastResultId = newestId;
        toastPausedRef.current = true;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toastPausedRef.current = false;
          doRecompute();
        }, AUTONOMOUS_TOAST_PAUSE_MS);
        doRecompute();
      }
    });

    // Initial computation now that all internal refs are seeded. Subsequent
    // calls (from event handlers / subscriptions) will fire onResume on
    // false → true transitions.
    doRecompute();
    initialized = true;

    return () => {
      mql.removeEventListener('change', handleMotionChange);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubGlobe();
      unsubMap();
      unsubData();
      unsubAgent();
      if (toastTimer) clearTimeout(toastTimer);
    };
    // Refs are stable identities, so this effect only runs once. The recompute
    // function captured here continues to read live ref values.
  }, [hoverPausedRef, interactionPausedRef, isFlyingRef]);

  return {
    shouldRotateRef,
    rampStartTimeRef,
    prefersReducedMotionRef,
    recompute,
  };
}

'use client';

import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { AUTO_ROTATE_RAMP_MS, useAutoRotatePause } from '@/lib/hooks/use-auto-rotate-pause';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';
import { latLonToVector3 } from '@/lib/utils/geo';

// ─── Constants ───
// Speed math: drei's OrbitControls integrates `(2π / 60) * autoRotateSpeed`
// radians per frame at 60 fps → `6 * autoRotateSpeed` degrees per second.
// For the spec'd 4 °/s (90 s per revolution): autoRotateSpeed = 4 / 6 ≈ 0.6667.
const AUTO_ROTATE_SPEED = 0.6667;
const FLY_TO_DURATION = 1.5; // seconds
const FLY_TO_DISTANCE = 2.2;
const DEFAULT_POSITION = new THREE.Vector3(0, 0, 3);
const GLOBE_ZOOM_STEP = 0.5;
const GLOBE_ZOOM_DURATION = 0.4;
const GLOBE_MIN_DISTANCE = 1.5;
const GLOBE_MAX_DISTANCE = 6;
const GLOBE_DEFAULT_DISTANCE = 3;

export function GlobeControls() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera, gl } = useThree();

  const cameraTarget = useGlobeStore((s) => s.cameraTarget);
  const resetCamera = useGlobeStore((s) => s.resetCamera);
  const pendingGlobeZoom = useGlobeStore((s) => s.pendingGlobeZoom);
  const clearPendingGlobeZoom = useGlobeStore((s) => s.clearPendingGlobeZoom);

  // ─── Caller-owned pause refs (fed into the shared pause hook) ───
  const hoverPausedRef = useRef(false);
  const interactionPausedRef = useRef(false);
  const isFlyingRef = useRef(false);

  const { shouldRotateRef, rampStartTimeRef, prefersReducedMotionRef, recompute } =
    useAutoRotatePause({ hoverPausedRef, interactionPausedRef, isFlyingRef });

  // ─── Fly-to animation state ───
  const flyAnimRef = useRef<{
    active: boolean;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    elapsed: number;
    duration: number;
  } | null>(null);

  // ─── Mirror globe-store.isFlying into the pause ref ───
  useEffect(() => {
    isFlyingRef.current = useGlobeStore.getState().isFlying;
    const unsub = useGlobeStore.subscribe((state, prev) => {
      if (state.isFlying !== prev.isFlying) {
        isFlyingRef.current = state.isFlying;
        recompute();
      }
    });
    return () => unsub();
  }, [recompute]);

  // ─── User interaction handlers (drag/zoom on the OrbitControls) ───
  const handleInteractionStart = useCallback(() => {
    interactionPausedRef.current = true;
    recompute();
  }, [recompute]);

  const handleInteractionEnd = useCallback(() => {
    interactionPausedRef.current = false;
    recompute();
  }, [recompute]);

  // ─── Hover detection on the R3F canvas DOM element ───
  useEffect(() => {
    const canvas = gl.domElement;
    const parent = canvas.parentElement ?? canvas;
    const handlePointerEnter = () => {
      hoverPausedRef.current = true;
      recompute();
    };
    const handlePointerLeave = () => {
      hoverPausedRef.current = false;
      recompute();
    };
    parent.addEventListener('pointerenter', handlePointerEnter);
    parent.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      parent.removeEventListener('pointerenter', handlePointerEnter);
      parent.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [gl, recompute]);

  // ─── Trigger fly-to animation when cameraTarget changes ───
  useEffect(() => {
    if (!cameraTarget) return;

    const [lat, lon] = cameraTarget;
    const targetPos = latLonToVector3(lat, lon, FLY_TO_DISTANCE);

    // Flip store.isFlying = true. The mirror effect above will set
    // isFlyingRef and trigger recompute, pausing rotation for the lerp.
    useGlobeStore.setState({ isFlying: true });

    flyAnimRef.current = {
      active: true,
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(targetPos[0], targetPos[1], targetPos[2]),
      elapsed: 0,
      duration: FLY_TO_DURATION,
    };
  }, [cameraTarget, camera]);

  // ─── Double-click to reset view ───
  const handleDoubleClick = useCallback(() => {
    // Double-click reset is a user-initiated "take me home" gesture —
    // release any agent navigation lock so rotation can resume after the
    // fly-home animation lands.
    useMapStore.getState().clearNavigationLock();
    useGlobeStore.setState({ isFlying: true });
    flyAnimRef.current = {
      active: true,
      startPos: camera.position.clone(),
      endPos: DEFAULT_POSITION.clone(),
      elapsed: 0,
      duration: FLY_TO_DURATION,
    };
    resetCamera();
  }, [camera, resetCamera]);

  // Listen for double-click on the canvas
  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    canvas.addEventListener('dblclick', handleDoubleClick);
    return () => canvas.removeEventListener('dblclick', handleDoubleClick);
  }, [handleDoubleClick]);

  // ─── Handle zoom button requests from ZoomControls ───
  useEffect(() => {
    if (!pendingGlobeZoom) return;
    clearPendingGlobeZoom();

    const currentDistance = camera.position.length();
    let targetDistance: number;

    if (pendingGlobeZoom === 'reset') {
      targetDistance = GLOBE_DEFAULT_DISTANCE;
    } else if (pendingGlobeZoom === 'in') {
      targetDistance = Math.max(GLOBE_MIN_DISTANCE, currentDistance - GLOBE_ZOOM_STEP);
    } else {
      targetDistance = Math.min(GLOBE_MAX_DISTANCE, currentDistance + GLOBE_ZOOM_STEP);
    }

    // Compute end position: same direction, new distance
    const direction = camera.position.clone().normalize();
    const endPos = direction.multiplyScalar(targetDistance);

    useGlobeStore.setState({ isFlying: true });

    flyAnimRef.current = {
      active: true,
      startPos: camera.position.clone(),
      endPos,
      elapsed: 0,
      duration: GLOBE_ZOOM_DURATION,
    };
  }, [pendingGlobeZoom, clearPendingGlobeZoom, camera]);

  // ─── Animation loop: smooth fly-to with easing + auto-rotation gate ───
  useFrame((_state, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // Gate auto-rotation by the shared pause signal + ramp factor.
    if (prefersReducedMotionRef.current) {
      controls.autoRotate = false;
    } else {
      const should = shouldRotateRef.current;
      controls.autoRotate = should;
      if (should) {
        const elapsed = performance.now() - rampStartTimeRef.current;
        const rampFactor = Math.min(elapsed / AUTO_ROTATE_RAMP_MS, 1);
        controls.autoRotateSpeed = AUTO_ROTATE_SPEED * rampFactor;
      } else {
        // Reset so the next resume starts from zero speed and ramps cleanly.
        controls.autoRotateSpeed = 0;
      }
    }

    // Process fly-to animation
    const anim = flyAnimRef.current;
    if (anim?.active) {
      anim.elapsed += delta;
      const rawT = Math.min(anim.elapsed / anim.duration, 1.0);

      // Smooth ease-in-out (cubic)
      const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - (-2 * rawT + 2) ** 3 / 2;

      // Lerp camera position
      camera.position.lerpVectors(anim.startPos, anim.endPos, t);
      camera.lookAt(0, 0, 0);
      controls.update();

      // End animation
      if (rawT >= 1.0) {
        flyAnimRef.current = null;
        // Clear isFlying so the rotation pause lifts — recompute fires via
        // the store subscription mirror above.
        useGlobeStore.setState({ isFlying: false });
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableZoom
      enablePan={false}
      enableRotate
      // Initial values; the useFrame loop above imperatively gates these per
      // frame based on the shared pause signal + ramp factor. Match the JSX
      // values to the runtime defaults so drei's prop-sync doesn't override
      // our useFrame writes between renders.
      autoRotate
      autoRotateSpeed={AUTO_ROTATE_SPEED}
      minDistance={1.5}
      maxDistance={6}
      enableDamping
      dampingFactor={0.05}
      makeDefault
      onStart={handleInteractionStart}
      onEnd={handleInteractionEnd}
    />
  );
}

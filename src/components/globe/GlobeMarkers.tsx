'use client';

import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGlobeStore } from '@/lib/store/globe-store';
import type { CyberCategory, GlobeMarker, Severity } from '@/lib/types';
import { isCyberMarker, markerVisibleForActiveLayers } from '@/lib/utils/cyber-markers';
import { latLonToVector3 } from '@/lib/utils/geo';

const MAX_INSTANCES = 512;

const SEVERITY_COLORS: Record<Severity, THREE.Color> = {
  critical: new THREE.Color('#ff0040'),
  high: new THREE.Color('#ff4444'),
  medium: new THREE.Color('#ffaa00'),
  low: new THREE.Color('#00ff41'),
  info: new THREE.Color('#666666'),
};

// Cyber category → distinctive color (overrides severity when present)
const CYBER_CATEGORY_COLORS: Record<CyberCategory, THREE.Color> = {
  cve: new THREE.Color('#ff4444'), // red-orange; severity tints further
  breach: new THREE.Color('#ff00aa'), // hot pink — distinct from CVEs
  threat_actor: new THREE.Color('#aa00ff'), // violet
  ai_incident: new THREE.Color('#00ffff'), // electric cyan
  ai_safety: new THREE.Color('#00ffaa'), // mint cyan
  ioc: new THREE.Color('#ff8800'), // orange
  critical_infra: new THREE.Color('#88aaff'), // soft blue
};

function resolveColor(marker: GlobeMarker): THREE.Color {
  if (isCyberMarker(marker)) {
    // Critical severity gets the cyber color shifted toward red; otherwise use
    // the cyber palette directly so APT vs AI vs IOC are visually distinct.
    if (marker.severity === 'critical' && marker.cyberCategory === 'cve') {
      return SEVERITY_COLORS.critical;
    }
    return CYBER_CATEGORY_COLORS[marker.cyberCategory];
  }
  return SEVERITY_COLORS[marker.severity] ?? SEVERITY_COLORS.info;
}

const MARKER_RADIUS = 0.012;
const BREATHE_MIN = 1.0;
const BREATHE_MAX = 1.15;
const BREATHE_PERIOD = 3.0; // seconds for full cycle
const BREATHE_AMPLITUDE = (BREATHE_MAX - BREATHE_MIN) / 2;
const BREATHE_CENTER = (BREATHE_MAX + BREATHE_MIN) / 2;

const tempObject = new THREE.Object3D();
const tempColor = new THREE.Color();

export function GlobeMarkers() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const rawMarkers = useGlobeStore((s) => s.markers);
  const hotspots = useGlobeStore((s) => s.hotspots);
  const hoveredMarkerId = useGlobeStore((s) => s.hoveredMarkerId);
  const selectedMarkerId = useGlobeStore((s) => s.selectedMarkerId);
  const selectMarker = useGlobeStore((s) => s.selectMarker);
  const selectHotspot = useGlobeStore((s) => s.selectHotspot);
  const hoverMarker = useGlobeStore((s) => s.hoverMarker);
  const flyTo = useGlobeStore((s) => s.flyTo);
  const activeLayers = useGlobeStore((s) => s.activeLayers);

  // Filter cyber markers by their per-category sidebar toggle. Non-cyber
  // markers always render (the master `markers` layer guards the whole mesh).
  const markers = useMemo(() => {
    return rawMarkers.filter((m) => markerVisibleForActiveLayers(m, activeLayers));
  }, [rawMarkers, activeLayers]);

  const count = Math.min(markers.length, MAX_INSTANCES);

  const positions = useMemo(() => {
    return markers.slice(0, MAX_INSTANCES).map((m) => latLonToVector3(m.lat, m.lon, 1.01));
  }, [markers]);

  // Build a color attribute array (cyber category overrides severity)
  const colorArray = useMemo(() => {
    const arr = new Float32Array(MAX_INSTANCES * 3);
    for (let i = 0; i < count; i++) {
      const marker = markers[i];
      if (marker) {
        const color = resolveColor(marker);
        arr[i * 3] = color.r;
        arr[i * 3 + 1] = color.g;
        arr[i * 3 + 2] = color.b;
      }
    }
    return arr;
  }, [markers, count]);

  // ─── Phase offsets for desynchronized breathing ───
  const phaseOffsets = useMemo(() => {
    const offsets = new Float32Array(MAX_INSTANCES);
    for (let i = 0; i < MAX_INSTANCES; i++) {
      // Use golden ratio for even distribution of phases
      offsets[i] = (i * 1.618033988749895) % 1.0;
    }
    return offsets;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const elapsed = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      const marker = markers[i];
      const pos = positions[i];
      if (!marker || !pos) continue;

      const isHovered = hoveredMarkerId === marker.id;
      const isSelected = selectedMarkerId === marker.id;

      // ── Breathing animation ──
      // Each marker has a unique phase offset so they breathe independently
      const phase = (phaseOffsets[i] ?? 0) * Math.PI * 2;
      const breatheT = Math.sin((elapsed / BREATHE_PERIOD) * Math.PI * 2 + phase);
      const breatheScale = BREATHE_CENTER + BREATHE_AMPLITUDE * breatheT;

      // Scale by count: count=1 → 1x, count=5 → 1.6x, count=8+ → 2x
      const countScale = Math.min(1 + (marker.count - 1) * 0.15, 2.0);

      // Selected (persistent, brightest) > hovered (transient preview) > default.
      // Drawer-driven selection lasts until the user picks another row.
      const scale = isSelected
        ? 2.1 * countScale
        : isHovered
          ? 1.6 * countScale
          : breatheScale * countScale;

      tempObject.position.set(pos[0], pos[1], pos[2]);
      tempObject.scale.setScalar(scale);
      tempObject.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObject.matrix);

      // ── Color with selection / hover brightness boost ──
      // Cyber category overrides severity; selection adds the warm amber
      // tint that matches the drawer's selected-row accent.
      const baseColor = resolveColor(marker);
      if (isSelected) {
        tempColor.copy(baseColor).lerp(new THREE.Color('#ffe066'), 0.35).multiplyScalar(2.2);
      } else if (isHovered) {
        tempColor.copy(baseColor).multiplyScalar(1.8);
      } else {
        // Subtle brightness pulse synced with breathing
        const brightPulse = 1.0 + 0.15 * breatheT;
        tempColor.copy(baseColor).multiplyScalar(brightPulse);
      }
      meshRef.current.setColorAt(i, tempColor);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const instanceId = e.instanceId;
      if (instanceId !== undefined && instanceId < count) {
        const marker = markers[instanceId];
        if (marker) {
          hoverMarker(marker.id);
          document.body.style.cursor = 'pointer';
        }
      }
    },
    [markers, count, hoverMarker],
  );

  const handlePointerOut = useCallback(() => {
    hoverMarker(null);
    document.body.style.cursor = 'auto';
  }, [hoverMarker]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const instanceId = e.instanceId;
      if (instanceId !== undefined && instanceId < count) {
        const marker = markers[instanceId];
        if (marker) {
          selectMarker(marker.id);
          flyTo(marker.lat, marker.lon);

          // If this marker corresponds to a hotspot, select it for the detail panel
          const hotspotId = marker.id.replace('hotspot-', '');
          const hotspot = hotspots.find((h) => h.id === hotspotId);
          if (hotspot) {
            selectHotspot(hotspot);
          }
        }
      }
    },
    [markers, hotspots, count, selectMarker, selectHotspot, flyTo],
  );

  if (count === 0) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Three.js R3F element, not an HTML element
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_INSTANCES]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <sphereGeometry args={[MARKER_RADIUS, 12, 12]} />
      <meshBasicMaterial toneMapped={false}>
        <instancedBufferAttribute attach="instanceColor" args={[colorArray, 3]} />
      </meshBasicMaterial>
    </instancedMesh>
  );
}

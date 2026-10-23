'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGlobeStore } from '@/lib/store/globe-store';
import type { Severity } from '@/lib/types';
import { latLonToVector3 } from '@/lib/utils/geo';

const SEVERITY_RING_COLORS: Record<Severity, string> = {
  critical: '#ff0040',
  high: '#ff4444',
  medium: '#ffaa00',
  low: '#00ff41',
  info: '#666666',
};

// ─── Ring count per hotspot ───
const RINGS_PER_HOTSPOT = 3;
// Stagger timing between rings (in seconds)
const RING_STAGGER = 0.8;
// Full cycle duration for a single ring
const RING_CYCLE_DURATION = 2.4;

interface ThreatRingProps {
  position: [number, number, number];
  normal: THREE.Vector3;
  color: string;
  phaseOffset: number;
}

function ThreatRing({ position, normal, color, phaseOffset }: ThreatRingProps) {
  const ringRef = useRef<THREE.Mesh>(null);

  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 0, 1);
    q.setFromUnitVectors(up, normal.clone().normalize());
    return q;
  }, [normal]);

  useFrame((state) => {
    if (!ringRef.current) return;
    const t = state.clock.elapsedTime + phaseOffset;

    // Normalized cycle position [0, 1)
    const cycle = (t * (1 / RING_CYCLE_DURATION)) % 1.0;

    // Ring expands outward from center
    const scale = 0.015 + cycle * 0.05;

    // Fade out as ring expands - radar sweep feel
    // Starts strong, fades to nothing
    const opacity = Math.max(0, (1.0 - cycle) * (1.0 - cycle));

    ringRef.current.scale.setScalar(scale);
    const mat = ringRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = opacity * 0.35;
  });

  return (
    <mesh ref={ringRef} position={position} quaternion={quaternion}>
      <ringGeometry args={[0.8, 1.0, 48]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

export function GlobeThreatRings() {
  const hotspots = useGlobeStore((s) => s.hotspots);

  const ringData = useMemo(() => {
    return hotspots.map((hotspot) => {
      const pos = latLonToVector3(hotspot.lat, hotspot.lon, 1.005);
      const normal = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
      const color = SEVERITY_RING_COLORS[hotspot.severity] ?? SEVERITY_RING_COLORS.info;
      return { id: hotspot.id, pos, normal, color };
    });
  }, [hotspots]);

  if (ringData.length === 0) return null;

  return (
    <group>
      {ringData.map((ring) => (
        <group key={ring.id}>
          {/* 3 concentric rings with staggered timing */}
          {Array.from({ length: RINGS_PER_HOTSPOT }, (_, i) => (
            <ThreatRing
              key={`${ring.id}-ring-${i}`}
              position={ring.pos}
              normal={ring.normal}
              color={ring.color}
              phaseOffset={i * RING_STAGGER}
            />
          ))}
        </group>
      ))}
    </group>
  );
}

'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/utils/geo';

const MAX_INSTANCES = 64;
const BASE_SIZE = 0.008;

interface BaseData {
  position: [number, number, number];
  significance: string;
}

const tempObject = new THREE.Object3D();

export function GlobeMilitaryBases() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [bases, setBases] = useState<BaseData[]>([]);

  useEffect(() => {
    fetch('/data/military-bases.json')
      .then((r) => r.json())
      .then((data) => {
        const fc = data as GeoJSON.FeatureCollection;
        const parsed = fc.features
          .filter((f) => f.geometry.type === 'Point')
          .map((f) => {
            const coords = (f.geometry as GeoJSON.Point).coordinates;
            const pos = latLonToVector3(coords[1]!, coords[0]!, 1.006);
            return {
              position: pos,
              significance: (f.properties?.significance as string) ?? 'medium',
            };
          });
        setBases(parsed);
      })
      .catch(() => {});
  }, []);

  const count = Math.min(bases.length, MAX_INSTANCES);

  useFrame((state) => {
    if (!meshRef.current || count === 0) return;
    const elapsed = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      const base = bases[i];
      if (!base) continue;
      tempObject.position.set(base.position[0], base.position[1], base.position[2]);
      // Orient diamond to face outward from globe center
      tempObject.lookAt(0, 0, 0);
      const scale =
        base.significance === 'critical' ? 1.3 : base.significance === 'high' ? 1.0 : 0.8;
      const pulse = 1.0 + 0.1 * Math.sin(elapsed * 2 + i * 0.5);
      tempObject.scale.setScalar(scale * pulse);
      tempObject.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObject.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_INSTANCES]}>
      <octahedronGeometry args={[BASE_SIZE, 0]} />
      <meshBasicMaterial color="#00ff88" transparent opacity={0.8} depthWrite={false} />
    </instancedMesh>
  );
}

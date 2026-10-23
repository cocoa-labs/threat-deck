'use client';

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/utils/geo';

const MAX_POINT_INSTANCES = 64;
const POINT_SIZE = 0.006;

const CATEGORY_COLORS: Record<string, string> = {
  transport: '#e8e8e8',
  energy: '#ffaa00',
  technology: '#00ff41',
  telecom: '#44ff88',
};

interface InfraLine {
  id: string;
  points: [number, number, number][];
  color: string;
}

interface InfraPoint {
  position: [number, number, number];
  color: THREE.Color;
}

const tempObject = new THREE.Object3D();

export function GlobeInfrastructure() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [rawData, setRawData] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch('/data/infrastructure.json')
      .then((r) => r.json())
      .then((data) => setRawData(data as GeoJSON.FeatureCollection))
      .catch(() => {});
  }, []);

  const { lines, points } = useMemo(() => {
    if (!rawData) return { lines: [] as InfraLine[], points: [] as InfraPoint[] };

    const lineFeatures: InfraLine[] = [];
    const pointFeatures: InfraPoint[] = [];

    for (const feature of rawData.features) {
      const category = (feature.properties?.category as string) ?? 'transport';
      const color = CATEGORY_COLORS[category] ?? '#888888';

      if (feature.geometry.type === 'LineString') {
        const coords = (feature.geometry as GeoJSON.LineString).coordinates;
        const pts = coords.map(([lon, lat]) => latLonToVector3(lat!, lon!, 1.005));
        lineFeatures.push({
          id: (feature.properties?.id as string) ?? `line-${lineFeatures.length}`,
          points: pts,
          color,
        });
      } else if (feature.geometry.type === 'Point') {
        const coords = (feature.geometry as GeoJSON.Point).coordinates;
        const pos = latLonToVector3(coords[1]!, coords[0]!, 1.005);
        pointFeatures.push({
          position: pos,
          color: new THREE.Color(color),
        });
      }
    }

    return { lines: lineFeatures, points: pointFeatures };
  }, [rawData]);

  const pointCount = Math.min(points.length, MAX_POINT_INSTANCES);

  // Build color array
  const colorArray = useMemo(() => {
    const arr = new Float32Array(MAX_POINT_INSTANCES * 3);
    for (let i = 0; i < pointCount; i++) {
      const pt = points[i];
      if (pt) {
        arr[i * 3] = pt.color.r;
        arr[i * 3 + 1] = pt.color.g;
        arr[i * 3 + 2] = pt.color.b;
      }
    }
    return arr;
  }, [points, pointCount]);

  useFrame(() => {
    if (!meshRef.current || pointCount === 0) return;

    for (let i = 0; i < pointCount; i++) {
      const pt = points[i];
      if (!pt) continue;
      tempObject.position.set(pt.position[0], pt.position[1], pt.position[2]);
      tempObject.scale.setScalar(1);
      tempObject.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObject.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (lines.length === 0 && pointCount === 0) return null;

  return (
    <group>
      {/* Infrastructure route lines */}
      {lines.map((line) => (
        <Line
          key={line.id}
          points={line.points}
          color={line.color}
          lineWidth={1.5}
          dashed
          dashSize={0.03}
          dashScale={1}
          gapSize={0.02}
          transparent
          opacity={0.5}
        />
      ))}

      {/* Infrastructure point markers (cubes) */}
      {pointCount > 0 && (
        <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_POINT_INSTANCES]}>
          <boxGeometry args={[POINT_SIZE, POINT_SIZE, POINT_SIZE]} />
          <meshBasicMaterial toneMapped={false} transparent opacity={0.8} depthWrite={false}>
            <instancedBufferAttribute attach="instanceColor" args={[colorArray, 3]} />
          </meshBasicMaterial>
        </instancedMesh>
      )}
    </group>
  );
}

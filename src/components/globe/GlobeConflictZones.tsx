'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/utils/geo';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff0040',
  high: '#ff4444',
  medium: '#ffaa00',
};

/** Convert a GeoJSON polygon ring to 3D points on the globe surface */
function ringToGlobePoints(ring: [number, number][]): THREE.Vector3[] {
  return ring.map(([lon, lat]) => {
    const pos = latLonToVector3(lat!, lon!, 1.004);
    return new THREE.Vector3(pos[0], pos[1], pos[2]);
  });
}

interface ZoneData {
  id: string;
  points: THREE.Vector3[];
  center: THREE.Vector3;
  color: string;
}

export function GlobeConflictZones() {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch('/data/conflict-zones.json')
      .then((r) => r.json())
      .then((data) => setGeojson(data as GeoJSON.FeatureCollection))
      .catch(() => {});
  }, []);

  const zones = useMemo((): ZoneData[] => {
    if (!geojson) return [];

    return geojson.features
      .filter((f) => f.geometry.type === 'Polygon')
      .map((feature) => {
        const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
        if (!coords) return null;
        const points = ringToGlobePoints(coords);
        const center = new THREE.Vector3();
        for (const p of points) center.add(p);
        center.divideScalar(points.length).normalize().multiplyScalar(1.004);
        const severity = (feature.properties?.severity as string) ?? 'medium';
        const color = SEVERITY_COLORS[severity] ?? '#ffaa00';
        return {
          id: (feature.properties?.id as string) ?? '',
          points,
          center,
          color,
        };
      })
      .filter((z): z is ZoneData => z !== null);
  }, [geojson]);

  if (zones.length === 0) return null;

  return (
    <group>
      {zones.map((zone) => {
        // Create a simple line loop for each zone boundary
        const positions = new Float32Array(zone.points.length * 3);
        for (let i = 0; i < zone.points.length; i++) {
          const p = zone.points[i]!;
          positions[i * 3] = p.x;
          positions[i * 3 + 1] = p.y;
          positions[i * 3 + 2] = p.z;
        }

        return (
          <group key={zone.id}>
            {/* Zone boundary line */}
            <lineLoop>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[positions, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={zone.color} transparent opacity={0.5} linewidth={1} />
            </lineLoop>
            {/* Faint filled region using a simple mesh */}
            <mesh position={zone.center}>
              <sphereGeometry args={[0.02, 8, 8]} />
              <meshBasicMaterial
                color={zone.color}
                transparent
                opacity={0.15}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

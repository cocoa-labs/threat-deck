'use client';

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import type { GlobeArc } from '@/lib/types';
import { greatCircleArc } from '@/lib/utils/geo';

interface ArcLineProps {
  arc: GlobeArc;
}

function ArcLine({ arc }: ArcLineProps) {
  // biome-ignore lint/suspicious/noExplicitAny: drei Line ref type is Line2 (internal, no stable export)
  const lineRef = useRef<any>(null);

  const points = useMemo(() => {
    return greatCircleArc(arc.fromLat, arc.fromLon, arc.toLat, arc.toLon, 50, 0.15);
  }, [arc.fromLat, arc.fromLon, arc.toLat, arc.toLon]);

  useFrame((state) => {
    if (!lineRef.current?.material) return;
    const mat = lineRef.current.material;
    if ('dashOffset' in mat) {
      mat.dashOffset = -state.clock.elapsedTime * 0.5;
    }
  });

  if (points.length < 2) return null;

  return (
    <Line
      ref={lineRef}
      points={points}
      color={arc.color}
      lineWidth={1.5}
      dashed
      dashSize={0.05}
      dashScale={1}
      gapSize={0.03}
      transparent
      opacity={0.7}
    />
  );
}

export function GlobeArcs() {
  const arcs = useGlobeStore((s) => s.arcs);

  if (arcs.length === 0) return null;

  return (
    <group>
      {arcs.map((arc) => (
        <ArcLine key={arc.id} arc={arc} />
      ))}
    </group>
  );
}

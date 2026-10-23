'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGlobeStore } from '@/lib/store/globe-store';

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 512;

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  info: 0.1,
};

/** WarGames color ramp: transparent -> dark blue -> cyan -> amber -> red */
function heatColor(intensity: number): string {
  if (intensity < 0.2) {
    const t = intensity / 0.2;
    return `rgba(10, 20, 80, ${t * 0.4})`;
  }
  if (intensity < 0.4) {
    const t = (intensity - 0.2) / 0.2;
    const r = Math.round(10 + t * (0 - 10));
    const g = Math.round(20 + t * (100 - 20));
    const b = Math.round(80 + t * (180 - 80));
    return `rgba(${r}, ${g}, ${b}, 0.6)`;
  }
  if (intensity < 0.6) {
    const t = (intensity - 0.4) / 0.2;
    const r = Math.round(0 + t * (0 - 0));
    const g = Math.round(100 + t * (170 - 100));
    const b = Math.round(180 + t * (255 - 180));
    return `rgba(${r}, ${g}, ${b}, 0.7)`;
  }
  if (intensity < 0.8) {
    const t = (intensity - 0.6) / 0.2;
    const r = Math.round(0 + t * 255);
    const g = Math.round(170 + t * (170 - 170));
    const b = Math.round(255 + t * (0 - 255));
    return `rgba(${r}, ${g}, ${b}, 0.8)`;
  }
  const t = (intensity - 0.8) / 0.2;
  const r = 255;
  const g = Math.round(170 - t * 170);
  const b = Math.round(0 + t * 64);
  return `rgba(${r}, ${g}, ${b}, 0.9)`;
}

export function GlobeHeatmap() {
  const markers = useGlobeStore((s) => s.markers);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Project each marker and draw radial gradient
    for (const marker of markers) {
      const weight = SEVERITY_WEIGHT[marker.severity] ?? 0.1;
      // Equirectangular projection
      const x = ((marker.lon + 180) / 360) * CANVAS_WIDTH;
      const y = ((90 - marker.lat) / 180) * CANVAS_HEIGHT;
      const radius = 30 + weight * 40;

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, heatColor(weight));
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    textureRef.current = tex;
    return tex;
  }, [markers]);

  if (!texture || markers.length === 0) return null;

  return (
    <mesh>
      <sphereGeometry args={[1.003, 64, 64]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.6}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

'use client';

import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { GlobeScene } from './GlobeScene';

function GlobeLoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
        <span className="text-xs text-zinc-500 tracking-wider uppercase">Initializing Globe</span>
      </div>
    </div>
  );
}

export function GlobeCanvas() {
  return (
    <div className="relative h-full w-full">
      <Suspense fallback={<GlobeLoadingFallback />}>
        <Canvas
          camera={{ position: [0, 0, 3], fov: 45 }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          style={{ background: 'transparent' }}
        >
          <GlobeScene />
        </Canvas>
      </Suspense>
    </div>
  );
}

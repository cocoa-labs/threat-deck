'use client';

import dynamic from 'next/dynamic';
import { useMapStore } from '@/lib/store/map-store';

/* ─── Canvas loading placeholder ─── */

function CanvasPlaceholder() {
  return (
    <div
      className="h-full w-full flex items-center justify-center"
      style={{
        background: 'var(--crt-panel-bg)',
        border: '1px solid rgba(var(--crt-glow-rgb), 0.1)',
      }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted)', animation: 'glow 2s ease-in-out infinite' }}
      >
        Initializing...
      </div>
    </div>
  );
}

/* ─── Dynamic imports (ssr: false) — match layout.tsx pattern ─── */

const GlobeCanvas = dynamic(
  () => import('@/components/globe/GlobeCanvas').then((mod) => mod.GlobeCanvas),
  { ssr: false, loading: () => <CanvasPlaceholder /> },
);

const MapCanvas = dynamic(() => import('@/components/map/MapCanvas').then((mod) => mod.MapCanvas), {
  ssr: false,
  loading: () => <CanvasPlaceholder />,
});

const CommandCanvas = dynamic(
  () => import('@/components/command/CommandCanvas').then((mod) => mod.CommandCanvas),
  { ssr: false, loading: () => <CanvasPlaceholder /> },
);

/**
 * GeoTab — mirrors the canvas-switching logic from layout.tsx's
 * `VisualizationLayer`. Reads `viewMode` (set by Sidebar's Globe/Map/Command
 * cycle) and renders the matching canvas. Inactive canvases are not
 * mounted — only the active mode renders.
 */
export function GeoTab() {
  const viewMode = useMapStore((s) => s.viewMode);

  if (viewMode === 'globe') {
    return <GlobeCanvas />;
  }

  if (viewMode === 'command') {
    return <CommandCanvas />;
  }

  return <MapCanvas />;
}

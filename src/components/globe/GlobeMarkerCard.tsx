'use client';

import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { CyberMarkerDetails } from '@/components/cyber/CyberMarkerDetails';
import { useGlobeStore } from '@/lib/store/globe-store';
import type { GlobeMarker, Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { isCyberMarker } from '@/lib/utils/cyber-markers';
import { latLonToVector3 } from '@/lib/utils/geo';

const SEVERITY_BADGE_CLASSES: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

function LegacyMarkerDetails({ marker }: { marker: GlobeMarker }) {
  return (
    <div className="min-w-[180px] max-w-[240px] space-y-1.5 px-3 py-2 font-mono">
      <p className="text-xs font-medium text-zinc-200 leading-tight">{marker.label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            SEVERITY_BADGE_CLASSES[marker.severity] ?? SEVERITY_BADGE_CLASSES.info,
          )}
        >
          {marker.severity}
        </span>
        {marker.count > 1 && (
          <span className="text-[10px] text-zinc-500">{marker.count} events</span>
        )}
      </div>
      {marker.description && (
        <p className="line-clamp-2 text-[10px] text-zinc-400">{marker.description}</p>
      )}
    </div>
  );
}

export function GlobeMarkerCard() {
  const hoveredMarkerId = useGlobeStore((s) => s.hoveredMarkerId);
  const markers = useGlobeStore((s) => s.markers);

  const marker = useMemo(() => {
    if (!hoveredMarkerId) return null;
    return markers.find((m) => m.id === hoveredMarkerId) ?? null;
  }, [hoveredMarkerId, markers]);

  if (!marker) return null;

  const pos = latLonToVector3(marker.lat, marker.lon, 1.04);

  return (
    <Html position={pos} center occlude distanceFactor={3} style={{ pointerEvents: 'none' }}>
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/95 shadow-xl backdrop-blur-sm">
        {isCyberMarker(marker) ? (
          <CyberMarkerDetails marker={marker} variant="compact" />
        ) : (
          <LegacyMarkerDetails marker={marker} />
        )}
      </div>
    </Html>
  );
}

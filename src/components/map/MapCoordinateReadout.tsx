'use client';

import { useMapStore } from '@/lib/store/map-store';

interface Props {
  lat: number | null;
  lon: number | null;
}

export function MapCoordinateReadout({ lat, lon }: Props) {
  const currentZoomTier = useMapStore((s) => s.currentZoomTier);
  const showCoordinateReadout = useMapStore((s) => s.showCoordinateReadout);

  if (!showCoordinateReadout) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] leading-relaxed"
      style={{ zIndex: 5 }}
    >
      <div className="rounded border border-[var(--color-positive)]/20 bg-[var(--bg-primary)]/80 px-2 py-1 backdrop-blur-sm">
        <div className="text-[var(--color-positive)]/80">
          LAT: {lat !== null ? lat.toFixed(4) : '\u2014'} LON:{' '}
          {lon !== null ? lon.toFixed(4) : '\u2014'}
        </div>
        <div className="text-[var(--text-muted)] uppercase">{currentZoomTier}</div>
      </div>
    </div>
  );
}

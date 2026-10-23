'use client';

import { useMapStore, zoomToTier } from '@/lib/store/map-store';
import type { ZoomTier } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

const TIERS: { id: ZoomTier; label: string; targetZoom: number }[] = [
  { id: 'global', label: 'GLOBAL', targetZoom: 2 },
  { id: 'country', label: 'COUNTRY', targetZoom: 7 },
  { id: 'city', label: 'CITY', targetZoom: 12 },
  { id: 'street', label: 'STREET', targetZoom: 16 },
];

export function MapZoomIndicator() {
  const zoom = useMapStore((s) => s.viewState.zoom);
  const flyTo = useMapStore((s) => s.flyTo);
  const viewState = useMapStore((s) => s.viewState);
  const currentTier = zoomToTier(zoom);

  const handleTierClick = (tier: (typeof TIERS)[number]) => {
    flyTo(viewState.latitude, viewState.longitude, tier.targetZoom);
  };

  // Calculate progress for the line indicator (0 = global, 1 = street)
  const tierIndex = TIERS.findIndex((t) => t.id === currentTier);
  const progress = Math.min(1, Math.max(0, tierIndex / (TIERS.length - 1)));

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 select-none">
      <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 px-3 py-2 backdrop-blur-sm">
        {/* Tier labels */}
        <div className="flex items-center gap-0.5">
          {TIERS.map((tier, i) => (
            <div key={tier.id} className="flex items-center">
              <button
                type="button"
                onClick={() => handleTierClick(tier)}
                className={cn(
                  'font-mono text-[9px] tracking-wider uppercase transition-colors duration-300 px-1 py-0.5 rounded',
                  currentTier === tier.id
                    ? 'text-[var(--color-info)] font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                )}
              >
                {tier.label}
              </button>
              {i < TIERS.length - 1 && (
                <span className="text-[8px] text-[var(--text-muted)] mx-0.5">▸</span>
              )}
            </div>
          ))}
        </div>

        {/* Progress track */}
        <div className="mt-1 flex items-center gap-0">
          <div className="relative h-[2px] w-full rounded-full bg-[var(--text-muted)]/20">
            <div
              className="absolute top-0 left-0 h-full rounded-full bg-[var(--color-info)] transition-all duration-500 ease-out"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>

        {/* Dot indicators */}
        <div className="mt-1 flex justify-between px-1">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-all duration-300',
                currentTier === tier.id
                  ? 'bg-[var(--color-info)] scale-125'
                  : 'bg-[var(--text-muted)]/40',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

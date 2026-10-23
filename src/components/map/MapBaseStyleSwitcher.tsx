'use client';

import type { MapBaseStyle } from '@/lib/store/map-store';
import { useMapStore } from '@/lib/store/map-store';
import { cn } from '@/lib/utils/cn';

/**
 * On-hero base-style switcher.
 *
 * The dark/satellite/terrain/3D choice used to live ONLY inside the Settings
 * gear dialog (and only appeared there in map view), so an operator looking at
 * the globe had no visible way to flip it to satellite — the exact "where do I
 * switch views?" gap. This puts the choice on the map itself, one labeled click
 * away, styled to match the zoom controls in the opposite corner.
 *
 * Base styles only apply to the Mapbox renderer, so the caller mounts this only
 * in `viewMode === 'map'`.
 */

const STYLES: { id: MapBaseStyle; label: string }[] = [
  { id: 'satellite', label: 'SAT' },
  { id: 'dark', label: 'DARK' },
  { id: 'terrain', label: 'TERRAIN' },
  { id: 'standard', label: '3D' },
];

export function MapBaseStyleSwitcher() {
  const baseStyle = useMapStore((s) => s.baseStyle);
  const setBaseStyle = useMapStore((s) => s.setBaseStyle);

  return (
    // biome-ignore lint/a11y/useSemanticElements: role="group" is the correct ARIA for a toggle-button set; <fieldset> would drag in form/border semantics this HUD control doesn't want.
    <div
      className="absolute top-3 left-3 z-20 flex overflow-hidden rounded border border-white/5 bg-[#0d0d0d]/80 backdrop-blur-sm"
      role="group"
      aria-label="Base map style"
    >
      {STYLES.map((s) => {
        const active = baseStyle === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setBaseStyle(s.id)}
            aria-pressed={active}
            title={`${s.label} view`}
            className={cn(
              'px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors',
              active
                ? 'bg-[rgba(var(--crt-glow-rgb),0.15)] text-[var(--crt-glow)]'
                : 'text-[var(--text-dim)] hover:text-[var(--crt-glow)]',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

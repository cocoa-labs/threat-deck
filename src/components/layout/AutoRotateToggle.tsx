'use client';

import { Orbit } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';
import { cn } from '@/lib/utils/cn';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(callback: () => void): () => void {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

/**
 * Slow auto-rotation pause/play toggle for the hero globe. Lives in the
 * left layer sidebar. Reads and writes `autoRotateEnabled` on globe-store
 * (which persists to localStorage `klammer-auto-rotate`).
 *
 * Hidden when:
 *   - user has `prefers-reduced-motion: reduce` (the rotation runtime
 *     refuses to spin anyway, so a no-op toggle would only confuse)
 *   - the geo hero tab isn't active
 *   - viewMode is 'command' (Command view doesn't rotate)
 *
 * Visual chrome matches the LayerButton pattern in Sidebar.tsx — same
 * 32×32 cell, same active-state accent bar, same tooltip on hover.
 */
export function AutoRotateToggle() {
  const autoRotateEnabled = useGlobeStore((s) => s.autoRotateEnabled);
  const setAutoRotateEnabled = useGlobeStore((s) => s.setAutoRotateEnabled);
  const viewMode = useMapStore((s) => s.viewMode);
  const heroTab = useMapStore((s) => s.heroTab);
  const clearNavigationLock = useMapStore((s) => s.clearNavigationLock);

  // Track prefers-reduced-motion at runtime so OS-level toggles take effect
  // without a reload. useSyncExternalStore is the recommended pattern for
  // mirroring external observable state into a React component — avoids the
  // setState-in-effect cascade and stays hydration-correct.
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  if (prefersReducedMotion) return null;
  if (heroTab !== 'geo') return null;
  if (viewMode === 'command') return null;

  const label = autoRotateEnabled ? 'Pause globe rotation' : 'Resume globe rotation';

  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      <span className="mb-1 text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
        Globe
      </span>
      <button
        type="button"
        onClick={() => {
          // Toggle click is an explicit "I'm taking the wheel" signal — also
          // release any agent navigation lock so rotation can resume on the
          // next on-toggle (subject to the zoom/hover/marker pauses).
          clearNavigationLock();
          setAutoRotateEnabled(!autoRotateEnabled);
        }}
        title={label}
        aria-label={label}
        aria-pressed={autoRotateEnabled}
        className={cn(
          'group relative flex h-8 w-8 items-center justify-center rounded-md transition-all duration-150',
          autoRotateEnabled
            ? 'bg-[var(--color-info)]/15 text-[var(--color-info)]'
            : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
        )}
      >
        {autoRotateEnabled && (
          <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--color-info)]" />
        )}
        <Orbit size={18} />
        <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-mono text-[var(--text-secondary)] opacity-0 shadow-md transition-opacity group-hover:opacity-100">
          {label}
        </span>
      </button>
    </div>
  );
}

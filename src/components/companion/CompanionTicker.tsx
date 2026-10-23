'use client';

import { useMemo, useState } from 'react';
import { useCompanionStore } from '@/lib/store/companion-store';
import { cn } from '@/lib/utils/cn';

export function CompanionTicker() {
  const tickerItems = useCompanionStore((s) => s.tickerItems);
  const sidebarOpen = useCompanionStore((s) => s.sidebarOpen);
  const [paused, setPaused] = useState(false);

  const renderItems = useMemo(() => [...tickerItems, ...tickerItems], [tickerItems]);
  const duration = useMemo(() => tickerItems.length * 6, [tickerItems.length]);

  if (tickerItems.length === 0) return null;

  const TYPE_COLORS: Record<string, string> = {
    headline: 'var(--color-warning)',
    market: 'var(--crt-glow)',
    insight: 'var(--color-positive)',
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-pause is a non-interactive UX enhancement
    <div
      className="fixed left-0 overflow-hidden bg-[var(--bg-primary)] border-t border-[var(--border-default)]"
      style={{
        height: 'var(--companion-ticker-height, 36px)',
        bottom: 0,
        right: sidebarOpen ? 'var(--companion-sidebar-width, 380px)' : 0,
        zIndex: 51,
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className={cn('flex items-center whitespace-nowrap h-full', paused && 'ticker-paused')}
        style={{
          animation: `ticker-scroll ${duration}s linear infinite`,
        }}
      >
        {renderItems.map((item, idx) => {
          const color = TYPE_COLORS[item.type] ?? 'var(--text-secondary)';
          return (
            <span key={`${item.id}-${idx}`} className="inline-flex items-center">
              {idx > 0 && (
                <span className="px-3 text-[9px] opacity-20 text-[var(--text-dim)]" aria-hidden>
                  |
                </span>
              )}
              <span
                className="inline-flex items-center gap-2 text-[10px] font-mono font-medium tracking-wide px-2 py-0.5"
                style={{ color }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: color, boxShadow: `0 0 4px ${color}` }}
                />
                <span className="text-[8px] opacity-50 uppercase tracking-widest">
                  {item.source}
                </span>
                <span>{item.text}</span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import type { Freshness } from '@/lib/utils/freshness';

/**
 * FreshnessTelltale — per-panel data-freshness signal light.
 *
 * A deliberate smaller sibling of the header <ConnectionStatus> indicator:
 * a glowing dot + uppercase Geist-Mono micro-label, sized to the 9px panel
 * header row. The visual language is shared on purpose — LIVE reuses the
 * concentric "ping" ring idiom (a live transmission light), so the panel
 * telltale reads as the same instrument scaled down.
 *
 * States (color from severity/brand tokens):
 *   live    — Matrix green, animated ping ring (transmission active)
 *   delayed — amber, steady dot + soft glow (polling, slightly behind)
 *   stale   — red, slow opacity "breathe" (attention — feed is overdue)
 *   demo    — cocoa brown, steady dot (seed/demo data, not live intel)
 *
 * Motion is decorative-only (no layout impact) and collapses to a steady
 * dot under prefers-reduced-motion via the `.freshness-ping` /
 * `.freshness-breathe` classes in globals.css.
 */

const COLOR: Record<Freshness, string> = {
  live: 'var(--severity-low)', // === --crt-glow Matrix green
  delayed: 'var(--severity-medium)',
  stale: 'var(--severity-critical)',
  demo: 'var(--cocoa-brown, #6b4423)', // brand brown — matches ModePillRow idiom
};

const LABEL: Record<Freshness, string> = {
  live: 'LIVE',
  delayed: 'DELAYED',
  stale: 'STALE',
  demo: 'DEMO',
};

const TITLE: Record<Freshness, string> = {
  live: 'Live — data refreshed within the live window',
  delayed: 'Delayed — polling, data is slightly behind',
  stale: 'Stale — feed is overdue for a refresh',
  demo: 'Demo — seed/demo data, not a live feed',
};

export function FreshnessTelltale({ freshness }: { freshness: Freshness }) {
  const color = COLOR[freshness];

  return (
    <span
      role="img"
      className="flex shrink-0 items-center gap-1"
      title={TITLE[freshness]}
      aria-label={`Data status: ${LABEL[freshness]}`}
    >
      {/* Signal light — fixed 6px footprint so swapping states never shifts layout */}
      <span className="relative flex h-1.5 w-1.5 items-center justify-center">
        {/* LIVE: expanding transmission ring (mirrors ConnectionStatus ping) */}
        {freshness === 'live' && (
          <span
            className="freshness-ping absolute inline-flex h-full w-full rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        {/* Steady core dot with CRT glow halo */}
        <span
          className={freshness === 'stale' ? 'freshness-breathe' : undefined}
          style={{
            display: 'inline-flex',
            height: '6px',
            width: '6px',
            borderRadius: '9999px',
            backgroundColor: color,
            boxShadow: `0 0 5px ${color}, 0 0 2px ${color}`,
          }}
        />
      </span>

      {/* Micro-label — aligned to the 9px header row */}
      <span
        data-testid="freshness-label"
        className="font-mono text-[9px] font-semibold uppercase leading-none tracking-[0.12em]"
        style={{ color }}
      >
        {LABEL[freshness]}
      </span>
    </span>
  );
}

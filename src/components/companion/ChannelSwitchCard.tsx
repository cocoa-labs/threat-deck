'use client';

import type React from 'react';
import type { ChannelSwitchData } from '@/lib/store/companion-store';

const CATEGORY_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  finance: {
    accent: 'var(--crt-glow)',
    bg: 'rgba(var(--crt-glow-rgb), 0.04)',
    border: 'rgba(var(--crt-glow-rgb), 0.2)',
  },
  crypto: {
    accent: 'var(--color-positive)',
    bg: 'rgba(68, 255, 136, 0.04)',
    border: 'rgba(68, 255, 136, 0.2)',
  },
  geopolitical: {
    accent: 'var(--color-warning)',
    bg: 'rgba(255, 170, 0, 0.04)',
    border: 'rgba(255, 170, 0, 0.2)',
  },
};

/**
 * Presentation card for channel switch responses.
 * Wraps the agent's markdown-rendered content with a styled channel header.
 * When `children` is provided, renders them as the card body (agent text).
 * Without children, renders a compact header-only card.
 */
export function ChannelSwitchCard({
  data,
  children,
}: {
  data: ChannelSwitchData;
  children?: React.ReactNode;
}) {
  const colors = CATEGORY_COLORS[data.category] ?? CATEGORY_COLORS.finance!;

  return (
    <div
      className="rounded-lg font-mono overflow-hidden"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        boxShadow: `0 0 12px color-mix(in srgb, ${colors.accent} 6%, transparent), inset 0 1px 0 color-mix(in srgb, ${colors.accent} 6%, transparent)`,
      }}
    >
      {/* ── Channel header bar ── */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: `color-mix(in srgb, ${colors.accent} 6%, transparent)`,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {/* Live indicator */}
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
            style={{ background: 'var(--color-negative)' }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{
              background: 'var(--color-negative)',
              boxShadow: '0 0 6px var(--color-negative)',
            }}
          />
        </span>
        <span
          className="text-[7px] font-bold uppercase tracking-[0.15em]"
          style={{ color: 'var(--color-negative)' }}
        >
          Live
        </span>

        {/* Separator dot */}
        <span
          className="h-0.5 w-0.5 rounded-full shrink-0"
          style={{ background: `color-mix(in srgb, ${colors.accent} 30%, transparent)` }}
        />

        {/* Channel name */}
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{
            color: colors.accent,
            textShadow: `0 0 10px color-mix(in srgb, ${colors.accent} 25%, transparent)`,
          }}
        >
          {data.channelLabel}
        </span>

        {/* Category badge */}
        <span
          className="ml-auto rounded px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider"
          style={{
            color: colors.accent,
            background: `color-mix(in srgb, ${colors.accent} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${colors.accent} 15%, transparent)`,
          }}
        >
          {data.category}
        </span>
      </div>

      {/* ── Card body: agent text or fallback info ── */}
      <div className="px-3 py-2.5">
        {children ? (
          <div className="text-[10px] leading-relaxed break-words">{children}</div>
        ) : (
          <>
            {/* Fallback: show video title + headlines when no agent text */}
            {data.nowPlaying?.videoTitle && (
              <div
                className="text-[9px] leading-relaxed truncate"
                style={{ color: 'var(--text-secondary)' }}
              >
                {data.nowPlaying.videoTitle}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

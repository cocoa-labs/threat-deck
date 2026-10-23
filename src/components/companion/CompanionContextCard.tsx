'use client';

import { AlertTriangle, Link, Newspaper, Subtitles, TrendingUp } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { CompanionContextUpdate } from '@/lib/store/companion-store';

const TYPE_ICONS: Record<CompanionContextUpdate['type'], typeof Subtitles> = {
  cc_digest: Subtitles,
  headline: Newspaper,
  market_link: TrendingUp,
  cross_reference: Link,
  topic_change: AlertTriangle,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'var(--severity-info)',
  medium: 'var(--severity-medium)',
  high: 'var(--severity-high)',
  critical: 'var(--severity-critical)',
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CompanionContextCard({ update }: { update: CompanionContextUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TYPE_ICONS[update.type];
  const severityColor = update.severity ? SEVERITY_COLORS[update.severity] : undefined;
  const isLong = update.content.length > 120;

  const handleToggle = useCallback(() => {
    if (isLong) setExpanded((prev) => !prev);
  }, [isLong]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click-to-expand is a non-interactive UX enhancement
    <div
      className="rounded px-3 py-2.5 font-mono"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${severityColor ? `color-mix(in srgb, ${severityColor} 25%, transparent)` : 'var(--border-default)'}`,
      }}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (isLong && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleToggle();
        }
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        <Icon size={13} style={{ color: severityColor ?? 'var(--crt-glow)', flexShrink: 0 }} />
        <span
          className="flex-1 text-[11px] font-semibold leading-tight truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {update.title}
        </span>
        {update.severity && (
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{
              background: severityColor,
              boxShadow: `0 0 6px ${severityColor}`,
            }}
          />
        )}
      </div>

      {/* Content */}
      <div
        className="mt-1.5 text-[10px] leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        {isLong && !expanded ? `${update.content.slice(0, 120)}...` : update.content}
      </div>

      {/* Footer: source + timestamp */}
      <div
        className="mt-1.5 flex items-center gap-2 text-[9px]"
        style={{ color: 'var(--text-dim)' }}
      >
        {update.source && <span className="uppercase tracking-wider">{update.source}</span>}
        <span>{formatTime(update.timestamp)}</span>
        {isLong && (
          <button
            type="button"
            className="ml-auto text-[var(--crt-glow)] hover:brightness-125"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle();
            }}
          >
            {expanded ? 'less' : 'more'}
          </button>
        )}
      </div>
    </div>
  );
}

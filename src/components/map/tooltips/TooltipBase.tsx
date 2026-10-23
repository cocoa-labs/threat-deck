'use client';

import type { Severity } from '@/lib/types';
import { relativeTime } from '@/lib/utils/geo';

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

interface Props {
  label: string;
  severity: Severity;
  category: string;
  timestamp?: string;
}

export function TooltipBase({ label, severity, category, timestamp }: Props) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{label}</p>
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${SEVERITY_BADGE[severity] ?? SEVERITY_BADGE.info}`}
        >
          {severity}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-dim)]">
          {category}
        </span>
        {timestamp && (
          <span className="text-[9px] font-mono text-[var(--text-muted)]">
            {relativeTime(timestamp)}
          </span>
        )}
      </div>
    </div>
  );
}

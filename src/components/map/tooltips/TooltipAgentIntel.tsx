'use client';

import type { Severity } from '@/lib/types';

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

interface Props {
  severity: Severity;
  confidence: number;
  description: string;
  remainingSeconds: number;
}

export function TooltipAgentIntel({ severity, confidence, description, remainingSeconds }: Props) {
  const mins = Math.floor(remainingSeconds / 60);
  const secs = Math.floor(remainingSeconds % 60);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${SEVERITY_BADGE[severity]}`}
        >
          {severity}
        </span>
        <span className="text-[9px] font-mono text-[var(--color-info)]">
          {Math.round(confidence * 100)}% confidence
        </span>
      </div>
      <p className="text-[10px] leading-relaxed text-[var(--text-dim)]">
        {description.length > 120 ? `${description.slice(0, 120)}...` : description}
      </p>
      <p className="text-[9px] font-mono text-[var(--text-muted)]">
        TTL: {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
      </p>
    </div>
  );
}

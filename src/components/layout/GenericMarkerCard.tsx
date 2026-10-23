'use client';

import { X } from 'lucide-react';
import type { GlobeMarker, Hotspot, Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { getMarkerSourceUrl } from '@/lib/utils/cyber-markers';
import { relativeTime } from '@/lib/utils/geo';
import { prefillAgent } from '@/lib/utils/panel-actions';

// Shared presentational card for NON-cyber markers, plus the raw-data helper and
// the analyze-prompt builder. Consumed by both MapMarkerOverlay's SingleMarkerCard
// (direct globe-marker hover) and LayerEventFlyout (drawer-row flyout) so the two
// surfaces render identical content without duplicating JSX.

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

/** Fire a Max analysis for a plain (non-agent) marker. Shared so the overlay card
 *  and the drawer flyout build the identical prompt + context. */
export function analyzeMarker(marker: GlobeMarker): void {
  prefillAgent(
    `Analyze "${marker.label}". Provide context, key data points, timeline, and actionable intelligence.`,
    {
      sourcePanel: 'map',
      dataType: marker.source,
      trendData: {
        label: marker.label,
        severity: marker.severity,
        category: marker.category,
        ...(marker.rawData ?? {}),
        sourceUrl: getMarkerSourceUrl(marker),
      },
      timestamp: marker.timestamp ?? undefined,
    },
  );
}

export function RawDataSection({ marker }: { marker: GlobeMarker }) {
  const raw = marker.rawData;
  if (!raw) return null;

  if (raw.member) {
    return (
      <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
        <p>
          <span className="text-[var(--text-muted)]">Member:</span> {raw.member} ({raw.party}-
          {raw.chamber})
        </p>
        <p>
          <span className="text-[var(--text-muted)]">Trade:</span> {raw.transactionType}{' '}
          {raw.tradeSymbol} — {raw.tradeAmount}
        </p>
      </div>
    );
  }

  if (raw.contractor) {
    return (
      <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
        <p>
          <span className="text-[var(--text-muted)]">Contractor:</span> {raw.contractor}
        </p>
        <p>
          <span className="text-[var(--text-muted)]">Agency:</span> {raw.agency}
        </p>
        {raw.contractAmount != null && (
          <p>
            <span className="text-[var(--text-muted)]">Value:</span> $
            {(raw.contractAmount / 1_000_000).toFixed(1)}M
          </p>
        )}
      </div>
    );
  }

  if (raw.txSymbol) {
    return (
      <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
        <p>
          <span className="text-[var(--text-muted)]">Asset:</span> {raw.txSymbol} on{' '}
          {raw.blockchain}
        </p>
        {raw.amountUsd != null && (
          <p>
            <span className="text-[var(--text-muted)]">Value:</span> $
            {(raw.amountUsd / 1_000_000).toFixed(1)}M
          </p>
        )}
        {raw.fromAddress && (
          <p className="truncate">
            <span className="text-[var(--text-muted)]">From:</span> {raw.fromAddress}
          </p>
        )}
        {raw.toAddress && (
          <p className="truncate">
            <span className="text-[var(--text-muted)]">To:</span> {raw.toAddress}
          </p>
        )}
      </div>
    );
  }

  if (raw.newsSource) {
    return (
      <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
        <p>
          <span className="text-[var(--text-muted)]">Source:</span> {raw.newsSource}
        </p>
        {raw.publishedAt && (
          <p>
            <span className="text-[var(--text-muted)]">Published:</span>{' '}
            {relativeTime(raw.publishedAt)}
          </p>
        )}
      </div>
    );
  }

  return null;
}

interface GenericMarkerCardProps {
  marker: GlobeMarker;
  hotspot?: Hotspot | null;
  onAnalyze?: () => void;
  onClose?: () => void;
  analyzeLabel?: string;
}

export function GenericMarkerCard({
  marker,
  hotspot,
  onAnalyze,
  onClose,
  analyzeLabel = 'Analyze',
}: GenericMarkerCardProps) {
  const badgeClasses = SEVERITY_BADGE[marker.severity] ?? SEVERITY_BADGE.info;

  return (
    <div className="p-3 min-w-[280px] max-w-[360px]">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] leading-snug">
          {marker.label}
        </h4>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
            badgeClasses,
          )}
        >
          {marker.severity}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-dim)]">
          {marker.category}
        </span>
        {marker.timestamp && (
          <span className="text-[9px] font-mono text-[var(--text-muted)]">
            {relativeTime(marker.timestamp)}
          </span>
        )}
      </div>

      {(hotspot || marker.description) && (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-dim)]">
          {hotspot?.description ?? marker.description ?? ''}
        </p>
      )}

      <RawDataSection marker={marker} />

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
          {marker.source}
        </span>
        {marker.url && (
          <a
            href={marker.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ pointerEvents: 'auto' }}
            className="text-[9px] text-[var(--color-info)] hover:underline truncate max-w-[120px]"
          >
            source link
          </a>
        )}
      </div>

      {onAnalyze && (
        <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onAnalyze}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-info)]/20 bg-[var(--color-info)]/5 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/10"
          >
            {analyzeLabel}
          </button>
        </div>
      )}
    </div>
  );
}

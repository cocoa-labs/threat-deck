'use client';

import { Fingerprint } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useIocData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { IOC, IocType } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const SOURCE_TABS = ['ALL', 'URLHAUS', 'MALWAREBAZAAR', 'THREATFOX'] as const;
type SourceTab = (typeof SOURCE_TABS)[number];

const IOC_TYPE_CHIPS = ['ALL', 'SHA256', 'URL', 'DOMAIN', 'IP'] as const;
type IocTypeChip = (typeof IOC_TYPE_CHIPS)[number];

const IOC_TYPE_COLORS: Record<IocType, string> = {
  sha256: 'var(--severity-high)',
  md5: 'var(--severity-medium)',
  url: 'var(--severity-critical)',
  domain: 'var(--severity-low)',
  ip: 'var(--color-info)',
  email: 'var(--severity-medium)',
};

const SOURCE_LABELS: Record<string, string> = {
  urlhaus: 'urlhaus',
  malwarebazaar: 'mb',
  threatfox: 'tf',
};

/* ─── Helpers ─── */

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return Array.from(new Set(values.filter(Boolean)));
}

function makeIocKey(ioc: IOC, index: number): string {
  return [
    ioc.source ?? 'unknown',
    ioc.iocType,
    ioc.value,
    ioc.firstSeen ?? '',
    ioc.lastSeen ?? '',
    index,
  ].join(':');
}

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="flex items-center gap-2 py-1.5 px-1">
      <div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-3 flex-1 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── Confidence Bar ─── */

function ConfidenceBar({ value }: { value: number | undefined }) {
  const pct = value != null ? Math.min(value, 1) * 100 : 0;
  const color =
    pct >= 75
      ? 'var(--severity-critical)'
      : pct >= 50
        ? 'var(--severity-high)'
        : pct >= 25
          ? 'var(--severity-medium)'
          : 'var(--severity-low)';
  return (
    <div className="flex items-center gap-1 w-[40px]">
      <div className="flex-1 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[7px] font-mono tabular-nums text-[var(--text-dim)]">
        {value != null ? Math.round(pct) : '—'}
      </span>
    </div>
  );
}

/* ─── IOC Row ─── */

function IocRow({ ioc }: { ioc: IOC }) {
  const typeColor = IOC_TYPE_COLORS[ioc.iocType] ?? 'var(--text-muted)';
  const sourceLabel = ioc.source ? (SOURCE_LABELS[ioc.source] ?? ioc.source) : '—';
  const tags = uniqueStrings(ioc.tags);

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `Analyze this IOC: ${ioc.value} (${ioc.iocType.toUpperCase()}). Source: ${ioc.source ?? 'N/A'}. Confidence: ${ioc.confidence != null ? Math.round(ioc.confidence * 100) : 'N/A'}%. Tags: ${tags.join(', ') || 'none'}.`,
          {
            sourcePanel: 'iocFeed',
            dataType: 'ioc',
            trendData: {
              iocType: ioc.iocType,
              value: ioc.value,
              source: ioc.source,
              confidence: ioc.confidence,
              tags,
              firstSeen: ioc.firstSeen,
              lastSeen: ioc.lastSeen,
              relatedCveId: ioc.relatedCveId,
              relatedActorId: ioc.relatedActorId,
            },
          },
        )
      }
      className="w-full text-left p-1.5 rounded transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
    >
      {/* Line 1: Type + value + source + confidence */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className="text-[7px] font-mono font-bold px-1 py-0.5 rounded uppercase shrink-0"
          style={{
            color: typeColor,
            backgroundColor: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
          }}
        >
          {ioc.iocType}
        </span>
        <span
          className="text-[9px] font-mono text-[var(--text-primary)] truncate flex-1"
          title={ioc.value}
        >
          {truncate(ioc.value, 60)}
        </span>
        <span className="text-[7px] font-mono uppercase text-[var(--text-dim)] shrink-0">
          {sourceLabel}
        </span>
        <ConfidenceBar value={ioc.confidence} />
      </div>

      {/* Line 2: Time + tags */}
      <div className="flex items-center gap-1.5 flex-wrap pl-1">
        {ioc.firstSeen && (
          <span className="text-[7px] font-mono text-[var(--text-muted)]">
            first {formatRelativeTime(ioc.firstSeen)}
          </span>
        )}
        {ioc.lastSeen && ioc.lastSeen !== ioc.firstSeen && (
          <span className="text-[7px] font-mono text-[var(--text-muted)]">
            last {formatRelativeTime(ioc.lastSeen)}
          </span>
        )}
        {tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-[7px] font-mono px-1 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-dim)]"
          >
            {tag}
          </span>
        ))}
      </div>
    </button>
  );
}

/* ─── IOCFeedPanel ─── */

export function IOCFeedPanel() {
  const [sourceTab, setSourceTab] = useState<SourceTab>('ALL');
  const [typeChip, setTypeChip] = useState<IocTypeChip>('ALL');

  const queryOpts = useMemo(
    () => ({
      source: sourceTab === 'ALL' ? undefined : sourceTab.toLowerCase(),
      iocType: typeChip === 'ALL' ? undefined : typeChip.toLowerCase(),
      limit: 50,
    }),
    [sourceTab, typeChip],
  );

  const { isLoading } = useIocData(queryOpts);
  const iocs = useDataStore((s) => s.iocs);

  const hasData = iocs.length > 0;

  return (
    <PanelShell id="iocFeed" title="IOC FEED" span={1}>
      {/* Source tabs */}
      <div className="flex items-center gap-0.5 mb-1.5 -mt-1 border-b border-[var(--border-subtle)] overflow-x-auto">
        {SOURCE_TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setSourceTab(tab)}
            className={cn(
              'px-1.5 py-1 text-[8px] font-mono font-semibold uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap',
              sourceTab === tab
                ? 'text-[var(--text-primary)] border-[var(--color-info)]'
                : 'text-[var(--text-dim)] border-transparent hover:text-[var(--text-secondary)]',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Type filter chips */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {IOC_TYPE_CHIPS.map((chip) => (
          <button
            type="button"
            key={chip}
            onClick={() => setTypeChip(chip)}
            className={cn(
              'text-[7px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors',
              typeChip === chip
                ? 'text-[var(--crt-glow)] border-[var(--crt-glow)] bg-[rgba(var(--crt-glow-rgb),0.1)]'
                : 'text-[var(--text-dim)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]',
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && !hasData ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center gap-2">
          <Fingerprint size={14} className="text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono text-[var(--text-muted)]">No IOCs available</span>
        </div>
      ) : (
        <div className="space-y-0.5">
          {iocs.map((ioc, index) => (
            <IocRow key={makeIocKey(ioc, index)} ioc={ioc} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

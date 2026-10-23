'use client';

import { Package, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { usePatchData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { Advisory, CveSeverity } from '@/lib/types';
import { advisoryIdentityKey } from '@/lib/utils/advisory-identity';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const VENDOR_TABS = ['ALL', 'MICROSOFT', 'APPLE', 'UBUNTU', 'REDHAT', 'CHROME', 'MOZILLA'] as const;
type VendorTab = (typeof VENDOR_TABS)[number];

const VENDOR_KEYS: Record<Exclude<VendorTab, 'ALL'>, string> = {
  MICROSOFT: 'microsoft',
  APPLE: 'apple',
  UBUNTU: 'ubuntu',
  REDHAT: 'redhat',
  CHROME: 'chrome',
  MOZILLA: 'mozilla',
};

const VENDOR_LABELS: Record<string, string> = {
  microsoft: 'Microsoft',
  apple: 'Apple',
  ubuntu: 'Ubuntu',
  redhat: 'Red Hat',
  chrome: 'Chrome',
  mozilla: 'Mozilla',
};

const SEVERITY_COLORS: Record<CveSeverity, string> = {
  critical: 'var(--severity-critical)',
  high: 'var(--severity-high)',
  medium: 'var(--severity-medium)',
  low: 'var(--severity-low)',
};

/* ─── Helpers ─── */

function inferVendor(advisory: Advisory): string {
  // Try advisoryId prefix first (e.g. "microsoft-...", "apple-...")
  if (advisory.advisoryId) {
    const lc = advisory.advisoryId.toLowerCase();
    for (const key of Object.keys(VENDOR_LABELS)) {
      if (lc.startsWith(`${key}-`) || lc.startsWith(`${key}_`)) {
        return key;
      }
    }
  }
  // Labels are derived from parsed hostnames, never URL substrings.
  if (advisory.advisoryUrl) {
    try {
      const host = new URL(advisory.advisoryUrl).hostname;
      const domains: Record<string, string[]> = {
        microsoft: ['microsoft.com'],
        apple: ['apple.com'],
        ubuntu: ['ubuntu.com'],
        redhat: ['redhat.com'],
        chrome: ['chromereleases.googleblog.com', 'chromium.org'],
        mozilla: ['mozilla.org'],
      };
      for (const [vendor, names] of Object.entries(domains)) {
        if (names.some((domain) => host === domain || host.endsWith(`.${domain}`))) return vendor;
      }
    } catch {
      /* Unparseable feed URLs do not establish a vendor. */
    }
  }
  return 'other';
}

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="p-2 rounded border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between mb-1">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <div className="h-2.5 w-3/4 animate-pulse rounded bg-[var(--bg-hover)] mb-0.5" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── Advisory Row ─── */

function AdvisoryRow({ advisory }: { advisory: Advisory }) {
  const sev = advisory.severity ?? 'low';
  const sevColor = SEVERITY_COLORS[sev] ?? 'var(--text-muted)';
  const cves = advisory.affectedCves ?? [];
  const visibleCves = cves.slice(0, 3);
  const extraCves = cves.length - 3;

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `Tell me about this patch: ${advisory.advisoryId ?? advisory.title ?? 'Vendor advisory'}. Affected CVEs: ${cves.join(', ') || 'N/A'}. ${advisory.summary ?? ''}`,
          {
            sourcePanel: 'patchTracker',
            dataType: 'patch',
            trendData: {
              advisoryId: advisory.advisoryId,
              issuer: advisory.issuer,
              title: advisory.title,
              severity: advisory.severity,
              affectedCves: advisory.affectedCves,
              affectedProducts: advisory.affectedProducts,
              publishedAt: advisory.publishedAt,
              advisoryUrl: advisory.advisoryUrl,
              sourceUrl: advisory.advisoryUrl,
            },
          },
        )
      }
      className="w-full text-left p-2 rounded border border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:border-[rgba(var(--crt-glow-rgb),0.3)] cursor-pointer"
    >
      <div className="flex items-center justify-between gap-1.5 mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Wrench size={10} className="shrink-0 text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono font-semibold text-[var(--text-primary)] truncate">
            {advisory.advisoryId ?? advisory.title ?? `Advisory #${advisory.id}`}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-[7px] font-mono font-bold px-1 py-0.5 rounded uppercase"
            style={{
              color: sevColor,
              backgroundColor: `color-mix(in srgb, ${sevColor} 15%, transparent)`,
            }}
          >
            {sev}
          </span>
          <span className="text-[7px] font-mono text-[var(--text-muted)] tabular-nums">
            {formatRelativeTime(advisory.publishedAt)}
          </span>
        </div>
      </div>

      {advisory.title && advisory.advisoryId && (
        <div className="text-[9px] font-mono text-[var(--text-secondary)] line-clamp-1 mb-0.5">
          {advisory.title}
        </div>
      )}

      {visibleCves.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-1">
          {visibleCves.map((cve) => (
            <span
              key={cve}
              className="text-[7px] font-mono px-1 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-dim)] tabular-nums"
            >
              {cve}
            </span>
          ))}
          {extraCves > 0 && (
            <span className="text-[7px] font-mono text-[var(--text-muted)]">+{extraCves} more</span>
          )}
        </div>
      )}
    </button>
  );
}

/* ─── Vendor Group ─── */

function VendorGroup({ vendor, advisories }: { vendor: string; advisories: Advisory[] }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[8px] font-mono font-semibold text-[var(--crt-glow)] uppercase tracking-wider">
        <Package size={10} />
        <span>{VENDOR_LABELS[vendor] ?? vendor}</span>
        <span className="text-[var(--text-muted)]">({advisories.length})</span>
      </div>
      <div className="space-y-1.5">
        {advisories.map((adv) => (
          <AdvisoryRow key={advisoryIdentityKey(adv)} advisory={adv} />
        ))}
      </div>
    </div>
  );
}

/* ─── PatchTrackerPanel ─── */

export function PatchTrackerPanel() {
  const [activeTab, setActiveTab] = useState<VendorTab>('ALL');

  const queryOpts = useMemo(
    () => ({
      vendor: activeTab === 'ALL' ? undefined : VENDOR_KEYS[activeTab],
      limit: 30,
    }),
    [activeTab],
  );

  const { isLoading } = usePatchData(queryOpts);
  // `patches`, not `advisories` — this panel is vendor-only. Both hooks used to
  // write the `advisories` slice, so CERT rows regularly rendered under the
  // vendor tabs and in a group headed "other".
  const advisories = useDataStore((s) => s.patches);

  const hasData = advisories.length > 0;

  // Group by vendor when ALL selected, otherwise flat
  const grouped = useMemo(() => {
    if (activeTab !== 'ALL') return null;
    const groups: Record<string, Advisory[]> = {};
    for (const adv of advisories) {
      const v = inferVendor(adv);
      if (!groups[v]) groups[v] = [];
      groups[v].push(adv);
    }
    return groups;
  }, [advisories, activeTab]);

  return (
    <PanelShell id="patchTracker" title="PATCH TRACKER" span={1}>
      {/* Vendor tabs */}
      <div className="flex items-center gap-0.5 mb-2 -mt-1 border-b border-[var(--border-subtle)] overflow-x-auto">
        {VENDOR_TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-1.5 py-1 text-[8px] font-mono font-semibold uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap',
              activeTab === tab
                ? 'text-[var(--text-primary)] border-[var(--color-info)]'
                : 'text-[var(--text-dim)] border-transparent hover:text-[var(--text-secondary)]',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && !hasData ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No advisories available
          </span>
        </div>
      ) : grouped ? (
        <div className="space-y-3">
          {Object.entries(grouped)
            .sort(([, a], [, b]) => b.length - a.length)
            .map(([vendor, advs]) => (
              <VendorGroup key={vendor} vendor={vendor} advisories={advs} />
            ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {advisories.map((adv) => (
            <AdvisoryRow key={advisoryIdentityKey(adv)} advisory={adv} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

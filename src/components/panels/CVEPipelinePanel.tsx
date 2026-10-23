'use client';

import { AlertTriangle, Bug, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useFreshness } from '@/lib/hooks/use-freshness';
import { useAegisCves } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { CveSeverity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { flyToCVE } from '@/lib/utils/cyber-fly';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

// CVEs ingest on a slow cadence — live if refreshed within 20m, stale past 2h.
const FRESHNESS = { liveMs: 20 * 60_000, staleMs: 2 * 60 * 60_000 };

const SEVERITY_TABS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
type SeverityTab = (typeof SEVERITY_TABS)[number];

const SEVERITY_COLORS: Record<CveSeverity, string> = {
  critical: 'var(--severity-critical)',
  high: 'var(--severity-high)',
  medium: 'var(--severity-medium)',
  low: 'var(--severity-low)',
};

const SEVERITY_LABELS: Record<CveSeverity, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

/* ─── Row shape (from /api/aegis/cves) ─── */

interface CveRow {
  cveId: string;
  publishedAt?: string;
  severity?: CveSeverity | null;
  cvssV3Score?: number;
  epssScore?: number;
  epssPercentile?: number;
  isKev?: boolean;
  exploitedInWild?: boolean;
  pocPublic?: boolean;
  summary?: string;
  primaryVendor?: string | null;
  primaryProduct?: string | null;
  tags?: string[];
  sourceUrl?: string;
}

/* ─── Helpers ─── */

function formatCvss(v: number | undefined): string {
  if (v == null) return '—';
  return v.toFixed(1);
}

function getCvssColor(v: number | undefined): string {
  if (v == null) return 'var(--text-muted)';
  if (v >= 9.0) return 'var(--severity-critical)';
  if (v >= 7.0) return 'var(--severity-high)';
  if (v >= 4.0) return 'var(--severity-medium)';
  return 'var(--severity-low)';
}

/* ─── Shimmer ─── */

function ShimmerCard() {
  return (
    <div className="p-2 rounded border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between mb-1.5">
        <div className="h-3 w-28 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <div className="h-2.5 w-3/4 animate-pulse rounded bg-[var(--bg-hover)] mb-1" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── CVE Card ─── */

function CveCard({ cve }: { cve: CveRow }) {
  const severityColor = cve.severity
    ? (SEVERITY_COLORS[cve.severity] ?? 'var(--text-muted)')
    : 'var(--text-muted)';
  const severityLabel = cve.severity
    ? (SEVERITY_LABELS[cve.severity] ?? cve.severity.toUpperCase())
    : 'UNKNOWN';
  const cvssColor = getCvssColor(cve.cvssV3Score);

  return (
    <button
      type="button"
      onClick={() => {
        // Fly the globe to this CVE's geo event if AEGIS DB has one
        flyToCVE(cve.cveId);
        prefillAgent(
          `Analyze ${cve.cveId}: ${cve.summary ?? 'CVE pipeline entry'}. Assess severity, exploitation status, and remediation priority.`,
          {
            sourcePanel: 'cvePipeline',
            dataType: 'cve',
            trendData: {
              cveId: cve.cveId,
              severity: cve.severity,
              cvssV3Score: cve.cvssV3Score,
              epssScore: cve.epssScore,
              isKev: cve.isKev,
              exploitedInWild: cve.exploitedInWild,
              summary: cve.summary,
              primaryVendor: cve.primaryVendor,
              primaryProduct: cve.primaryProduct,
              sourceUrl: cve.sourceUrl,
            },
          },
        );
      }}
      className="w-full text-left p-2 rounded border border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:border-[rgba(var(--crt-glow-rgb),0.3)] cursor-pointer"
    >
      {/* Line 1: CVE ID + Severity + CVSS + flags */}
      <div className="flex items-center justify-between gap-1.5 mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Bug size={10} className="shrink-0 text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono font-semibold text-[var(--text-primary)] truncate">
            {cve.cveId}
          </span>
          <span
            className="text-[7px] font-mono font-bold px-1 py-0.5 rounded shrink-0"
            style={{
              color: severityColor,
              backgroundColor: `color-mix(in srgb, ${severityColor} 15%, transparent)`,
            }}
          >
            {severityLabel}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {cve.cvssV3Score != null && (
            <span
              className="text-[10px] font-mono font-bold tabular-nums"
              style={{ color: cvssColor }}
              title="CVSS v3 score"
            >
              {formatCvss(cve.cvssV3Score)}
            </span>
          )}
          {cve.isKev && (
            <span
              className="text-[7px] font-mono font-bold px-1 py-0.5 rounded"
              style={{
                color: 'var(--severity-critical)',
                backgroundColor: 'color-mix(in srgb, var(--severity-critical) 15%, transparent)',
              }}
              title="Known Exploited Vulnerability"
            >
              KEV
            </span>
          )}
          {cve.exploitedInWild && (
            <span
              className="text-[7px] font-mono font-bold px-1 py-0.5 rounded flex items-center gap-0.5"
              style={{
                color: 'var(--severity-high)',
                backgroundColor: 'color-mix(in srgb, var(--severity-high) 15%, transparent)',
              }}
              title="Exploited in the wild"
            >
              <AlertTriangle size={7} />
              ITW
            </span>
          )}
        </div>
      </div>

      {/* Line 2: vendor / product */}
      {(cve.primaryVendor || cve.primaryProduct) && (
        <div className="text-[8px] font-mono text-[var(--text-dim)] truncate mb-0.5">
          {[cve.primaryVendor, cve.primaryProduct].filter(Boolean).join(' / ')}
        </div>
      )}

      {/* Line 3: summary */}
      {cve.summary && (
        <div className="text-[9px] font-mono text-[var(--text-secondary)] line-clamp-2 leading-snug">
          {cve.summary}
        </div>
      )}
    </button>
  );
}

/* ─── CVEPipelinePanel ─── */

export function CVEPipelinePanel() {
  const [activeTab, setActiveTab] = useState<SeverityTab>('ALL');
  const [kevOnly, setKevOnly] = useState(false);
  const [exploitedOnly, setExploitedOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input (300ms)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const queryOpts = useMemo(
    () => ({
      severity: activeTab === 'ALL' ? undefined : (activeTab.toLowerCase() as CveSeverity),
      isKev: kevOnly ? true : undefined,
      exploited: exploitedOnly ? true : undefined,
      search: debouncedSearch || undefined,
      limit: 50,
    }),
    [activeTab, kevOnly, exploitedOnly, debouncedSearch],
  );

  const { isLoading, dataUpdatedAt } = useAegisCves(queryOpts);
  const cves = useDataStore((s) => s.cves) as unknown as CveRow[];

  const hasData = cves.length > 0;
  const freshness = useFreshness(dataUpdatedAt, FRESHNESS);

  // Stage breakdown (always from current set)
  const breakdown = useMemo(() => {
    const counts: Record<CveSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const c of cves) {
      if (c.severity && c.severity in counts) counts[c.severity]++;
    }
    return counts;
  }, [cves]);

  return (
    <PanelShell
      id="cvePipeline"
      title="CVE PIPELINE"
      span={2}
      lastUpdated={dataUpdatedAt > 0 ? dataUpdatedAt : null}
      freshness={freshness}
    >
      {/* Filter bar */}
      <div className="flex items-center justify-between gap-1 mb-2 -mt-1 flex-wrap">
        {/* Severity tabs */}
        <div className="flex items-center gap-0.5 border-b border-[var(--border-subtle)] overflow-x-auto">
          {SEVERITY_TABS.map((tab) => (
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

        {/* Toggle pills + search */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setKevOnly((v) => !v)}
            className={cn(
              'text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors',
              kevOnly
                ? 'text-[var(--severity-critical)] border-[var(--severity-critical)] bg-[color-mix(in_srgb,var(--severity-critical)_15%,transparent)]'
                : 'text-[var(--text-dim)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]',
            )}
            title="Show only KEV catalog entries"
          >
            KEV
          </button>
          <button
            type="button"
            onClick={() => setExploitedOnly((v) => !v)}
            className={cn(
              'text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors',
              exploitedOnly
                ? 'text-[var(--severity-high)] border-[var(--severity-high)] bg-[color-mix(in_srgb,var(--severity-high)_15%,transparent)]'
                : 'text-[var(--text-dim)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]',
            )}
            title="Show only CVEs exploited in the wild"
          >
            ITW
          </button>
        </div>
      </div>

      {/* Search box */}
      <div className="flex items-center gap-1.5 mb-2 px-1.5 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <Search size={10} className="text-[var(--text-muted)] shrink-0" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search summaries..."
          className="flex-1 bg-transparent text-[9px] font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
        />
      </div>

      {/* Stage breakdown */}
      <div className="flex items-center gap-2 mb-2 text-[8px] font-mono">
        {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
          <div key={sev} className="flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: SEVERITY_COLORS[sev] }}
            />
            <span className="text-[var(--text-dim)] uppercase">{sev.slice(0, 3)}</span>
            <span className="text-[var(--text-secondary)] tabular-nums font-semibold">
              {breakdown[sev]}
            </span>
          </div>
        ))}
        <span className="text-[var(--text-muted)] ml-auto">{cves.length} total</span>
      </div>

      {/* Content */}
      {isLoading && !hasData ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerCard key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center gap-2">
          <ShieldAlert size={14} className="text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No CVEs match filters
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {cves.map((cve) => (
            <CveCard key={cve.cveId} cve={cve} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

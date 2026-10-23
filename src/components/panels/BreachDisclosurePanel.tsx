'use client';

import { FileWarning, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useFreshness } from '@/lib/hooks/use-freshness';
import { useBreachData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { BreachDisclosure } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { flyToBreach } from '@/lib/utils/cyber-fly';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

// Breach disclosures trickle in — live within 1h, stale past 6h.
const FRESHNESS = { liveMs: 60 * 60_000, staleMs: 6 * 60 * 60_000 };

const INDUSTRY_OPTIONS = [
  'all',
  'finance',
  'healthcare',
  'tech',
  'retail',
  'government',
  'energy',
] as const;
type IndustryFilter = (typeof INDUSTRY_OPTIONS)[number];

const COUNTRY_OPTIONS = ['all', 'us', 'uk', 'eu', 'ca', 'au', 'jp'] as const;
type CountryFilter = (typeof COUNTRY_OPTIONS)[number];

const INDUSTRY_LABELS: Record<IndustryFilter, string> = {
  all: 'All Industries',
  finance: 'Finance',
  healthcare: 'Healthcare',
  tech: 'Tech',
  retail: 'Retail',
  government: 'Government',
  energy: 'Energy',
};

const COUNTRY_LABELS: Record<CountryFilter, string> = {
  all: 'All Countries',
  us: 'US',
  uk: 'UK',
  eu: 'EU',
  ca: 'Canada',
  au: 'Australia',
  jp: 'Japan',
};

/* ─── Helpers ─── */

function formatRecords(v: number | undefined): string {
  if (v == null) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toLocaleString();
}

function inferOrgName(breach: BreachDisclosure): string {
  // HIBP doesn't structure org cleanly. Try sourceUrl domain first.
  if (breach.sourceUrl) {
    try {
      const url = new URL(breach.sourceUrl);
      const host = url.hostname.replace(/^www\./, '');
      // Take the second-level domain
      const parts = host.split('.');
      if (parts.length >= 2) {
        const sld = parts[parts.length - 2];
        if (sld && sld.length > 0) {
          return sld.charAt(0).toUpperCase() + sld.slice(1);
        }
      }
      return host;
    } catch {
      // ignore parse errors
    }
  }
  // Fall back to first sentence of notes
  if (breach.notes) {
    const firstSentence = breach.notes.split(/[.!?]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 0) {
      return firstSentence.length > 40 ? `${firstSentence.slice(0, 40)}…` : firstSentence;
    }
  }
  return `Breach #${breach.id}`;
}

function inferIndustry(breach: BreachDisclosure): string | null {
  const hay = `${breach.notes ?? ''} ${breach.breachType ?? ''}`.toLowerCase();
  if (hay.includes('financ') || hay.includes('bank')) return 'Finance';
  if (hay.includes('health') || hay.includes('medical') || hay.includes('hospital'))
    return 'Healthcare';
  if (hay.includes('retail') || hay.includes('ecommerce') || hay.includes('e-commerce'))
    return 'Retail';
  if (hay.includes('government') || hay.includes('federal')) return 'Government';
  if (hay.includes('energy') || hay.includes('utility')) return 'Energy';
  if (hay.includes('tech') || hay.includes('software') || hay.includes('platform')) return 'Tech';
  return null;
}

function inferCountry(breach: BreachDisclosure): string | null {
  const hay = `${breach.notes ?? ''} ${breach.sourceUrl ?? ''}`.toLowerCase();
  if (hay.includes('united states') || hay.includes(' us ') || hay.includes('.us')) return 'US';
  if (hay.includes('united kingdom') || hay.includes(' uk ') || hay.includes('.uk')) return 'UK';
  if (hay.includes('canada') || hay.includes(' ca ') || hay.includes('.ca')) return 'CA';
  if (hay.includes('australia') || hay.includes(' au ') || hay.includes('.au')) return 'AU';
  if (hay.includes('japan') || hay.includes(' jp ') || hay.includes('.jp')) return 'JP';
  return null;
}

function attestationDots(quality: 'low' | 'medium' | 'high' | undefined): number {
  switch (quality) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="p-2 rounded border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between mb-1">
        <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── Attestation Stars ─── */

function AttestationStars({ quality }: { quality: 'low' | 'medium' | 'high' | undefined }) {
  const filled = attestationDots(quality);
  const color =
    quality === 'high'
      ? 'var(--severity-critical)'
      : quality === 'medium'
        ? 'var(--severity-medium)'
        : 'var(--text-dim)';
  return (
    <div
      className="flex items-center gap-0.5"
      title={`Attestation quality: ${quality ?? 'unknown'}`}
    >
      {[1, 2, 3].map((i) => (
        <Star
          key={i}
          size={7}
          style={{
            fill: i <= filled ? color : 'transparent',
            color: i <= filled ? color : 'var(--text-muted)',
          }}
        />
      ))}
    </div>
  );
}

/* ─── Breach Row ─── */

function BreachRow({ breach }: { breach: BreachDisclosure }) {
  const orgName = inferOrgName(breach);
  const industry = inferIndustry(breach);
  const country = inferCountry(breach);

  return (
    <button
      type="button"
      onClick={() => {
        // Try to fly the globe to a corresponding breach event (no-op if not in AEGIS DB)
        flyToBreach(String(breach.id));
        prefillAgent(
          `Brief on breach: ${orgName}. ${breach.breachType ? `Type: ${breach.breachType}.` : ''} ${breach.recordsCompromised != null ? `Records: ${formatRecords(breach.recordsCompromised)}.` : ''} ${breach.notes ?? ''}`,
          {
            sourcePanel: 'breachDisclosure',
            dataType: 'breach',
            trendData: {
              id: breach.id,
              orgName,
              industry,
              country,
              disclosedAt: breach.disclosedAt,
              source: breach.source,
              sourceUrl: breach.sourceUrl,
              breachType: breach.breachType,
              recordsCompromised: breach.recordsCompromised,
              attestationQuality: breach.attestationQuality,
              relatedCveIds: breach.relatedCveIds,
              notes: breach.notes,
            },
          },
        );
      }}
      className="w-full text-left p-2 rounded border border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:border-[rgba(var(--crt-glow-rgb),0.3)] cursor-pointer"
    >
      <div className="flex items-center justify-between gap-1.5 mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <FileWarning size={10} className="shrink-0 text-[var(--severity-medium)]" />
          <span className="text-[10px] font-mono font-semibold text-[var(--text-primary)] truncate">
            {orgName}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {breach.breachType && (
            <span
              className="text-[7px] font-mono font-bold px-1 py-0.5 rounded uppercase"
              style={{
                color: 'var(--severity-high)',
                backgroundColor: 'color-mix(in srgb, var(--severity-high) 15%, transparent)',
              }}
            >
              {breach.breachType}
            </span>
          )}
          <AttestationStars quality={breach.attestationQuality} />
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
        {industry && (
          <span className="text-[7px] font-mono font-semibold px-1 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-dim)]">
            {industry}
          </span>
        )}
        {country && (
          <span className="text-[7px] font-mono font-semibold px-1 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-dim)]">
            {country}
          </span>
        )}
        {breach.recordsCompromised != null && (
          <span className="text-[8px] font-mono text-[var(--severity-medium)] tabular-nums">
            {formatRecords(breach.recordsCompromised)} records
          </span>
        )}
        <span className="text-[7px] font-mono text-[var(--text-muted)] ml-auto">
          {formatRelativeTime(breach.disclosedAt)}
        </span>
      </div>
    </button>
  );
}

/* ─── BreachDisclosurePanel ─── */

export function BreachDisclosurePanel() {
  const [industry, setIndustry] = useState<IndustryFilter>('all');
  const [country, setCountry] = useState<CountryFilter>('all');

  const queryOpts = useMemo(
    () => ({
      industry: industry === 'all' ? undefined : industry,
      country: country === 'all' ? undefined : country,
      limit: 30,
    }),
    [industry, country],
  );

  const { isLoading, dataUpdatedAt } = useBreachData(queryOpts);
  const breaches = useDataStore((s) => s.breaches);

  const hasData = breaches.length > 0;
  const freshness = useFreshness(dataUpdatedAt, FRESHNESS);

  return (
    <PanelShell
      id="breachDisclosure"
      title="BREACH DISCLOSURE"
      span={1}
      lastUpdated={dataUpdatedAt > 0 ? dataUpdatedAt : null}
      freshness={freshness}
    >
      {/* Filter bar */}
      <div className="flex items-center gap-1 mb-2 -mt-1 flex-wrap">
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value as IndustryFilter)}
          className={cn(
            'text-[8px] font-mono bg-[var(--bg-secondary)] text-[var(--text-secondary)]',
            'border border-[var(--border-subtle)] rounded px-1.5 py-0.5 cursor-pointer',
          )}
        >
          {INDUSTRY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {INDUSTRY_LABELS[opt]}
            </option>
          ))}
        </select>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value as CountryFilter)}
          className={cn(
            'text-[8px] font-mono bg-[var(--bg-secondary)] text-[var(--text-secondary)]',
            'border border-[var(--border-subtle)] rounded px-1.5 py-0.5 cursor-pointer',
          )}
        >
          {COUNTRY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {COUNTRY_LABELS[opt]}
            </option>
          ))}
        </select>
        <span className="text-[8px] font-mono text-[var(--text-dim)] ml-auto">
          {breaches.length} disclosures
        </span>
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
            No breach disclosures
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {breaches.map((breach) => (
            <BreachRow key={breach.id} breach={breach} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

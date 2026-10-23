'use client';

import { Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useAegisThreatActors } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import { cn } from '@/lib/utils/cn';
import { flyToActor } from '@/lib/utils/cyber-fly';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const ACTOR_TYPE_TABS = ['ALL', 'APT', 'RANSOMWARE', 'CRIMINAL', 'HACKTIVIST'] as const;
type ActorTypeTab = (typeof ACTOR_TYPE_TABS)[number];

const SORT_OPTIONS = ['composite', 'recency', 'capability'] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const SORT_LABELS: Record<SortOption, string> = {
  composite: 'Composite',
  recency: 'Recency',
  capability: 'Capability',
};

const GRADE_COLORS: Record<string, string> = {
  A: 'var(--severity-critical)',
  B: 'var(--severity-high)',
  C: 'var(--severity-medium)',
  D: 'var(--severity-low)',
  F: 'var(--text-muted)',
};

/* ─── Row shape (from /api/aegis/threat-actors) ─── */

interface ActorRow {
  actorId: string;
  displayName: string;
  aliases?: string[];
  actorType: string;
  attributionCountry?: string;
  sophistication?: string;
  lastActiveAt?: string;
  compositeScore?: number;
  actorGrade?: string;
  actorTier?: string;
  capabilityScore?: number;
  reachScore?: number;
  recencyScore?: number;
  velocityScore?: number;
  attributionConfidence?: number;
  campaignCount?: number;
  targetCount?: number;
  sourceUrl?: string;
}

/* ─── Helpers ─── */

function formatScore(v: number | undefined): string {
  if (v == null) return '—';
  return v.toFixed(0);
}

/* ─── Shimmer ─── */

function ShimmerCard() {
  return (
    <div className="p-2 rounded border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between mb-1">
        <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-4 w-8 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <div className="h-2.5 w-24 animate-pulse rounded bg-[var(--bg-hover)] mb-2" />
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-[var(--bg-hover)]" />
        ))}
      </div>
    </div>
  );
}

/* ─── Dimension Mini Cell ─── */

function DimCell({
  label,
  value,
  color,
}: {
  label: string;
  value: number | undefined;
  color: string;
}) {
  const pct = value != null ? Math.min(value, 100) : 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
        {label}
      </span>
      <div className="flex items-center gap-1 w-full">
        <div className="flex-1 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <span className="text-[8px] font-mono tabular-nums" style={{ color }}>
        {formatScore(value)}
      </span>
    </div>
  );
}

/* ─── Actor Card ─── */

function ActorCard({ actor }: { actor: ActorRow }) {
  const gradeColor = actor.actorGrade
    ? (GRADE_COLORS[actor.actorGrade] ?? 'var(--text-muted)')
    : 'var(--text-muted)';
  const aliasesPreview = (actor.aliases ?? []).slice(0, 2).join(', ');
  const extraAliases = (actor.aliases?.length ?? 0) - 2;

  return (
    <button
      type="button"
      onClick={() => {
        // Fly the globe/map to this actor's footprint if we have a marker for them.
        // No-op (silent) when the threat-actor layer is off or the seed isn't loaded.
        flyToActor(actor.actorId);
        prefillAgent(
          `Score this threat actor: ${actor.displayName} (${actor.actorType.toUpperCase()}). Composite: ${actor.compositeScore ?? 'N/A'} / Grade: ${actor.actorGrade ?? 'N/A'}. Analyze capability, reach, recency, velocity, and attribution.`,
          {
            sourcePanel: 'threatActorScores',
            dataType: 'threat_actor',
            trendData: {
              actorId: actor.actorId,
              displayName: actor.displayName,
              aliases: actor.aliases,
              actorType: actor.actorType,
              attributionCountry: actor.attributionCountry,
              compositeScore: actor.compositeScore,
              actorGrade: actor.actorGrade,
              capabilityScore: actor.capabilityScore,
              reachScore: actor.reachScore,
              recencyScore: actor.recencyScore,
              velocityScore: actor.velocityScore,
              attributionConfidence: actor.attributionConfidence,
              campaignCount: actor.campaignCount,
              targetCount: actor.targetCount,
              sourceUrl: actor.sourceUrl,
            },
          },
        );
      }}
      className="w-full text-left p-2 rounded border border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:border-[rgba(var(--crt-glow-rgb),0.3)] cursor-pointer"
    >
      {/* Line 1: Name + grade + composite */}
      <div className="flex items-center justify-between gap-1.5 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Target size={10} className="shrink-0 text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono font-semibold text-[var(--text-primary)] truncate">
            {actor.displayName}
          </span>
          <span className="text-[7px] font-mono text-[var(--text-dim)] uppercase tracking-wider shrink-0">
            {actor.actorType}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="text-[11px] font-mono font-bold tabular-nums leading-none"
            style={{ color: gradeColor }}
          >
            {formatScore(actor.compositeScore)}
          </span>
          {actor.actorGrade && (
            <span
              className="text-[8px] font-mono font-bold px-1 py-0.5 rounded"
              style={{
                color: gradeColor,
                backgroundColor: `color-mix(in srgb, ${gradeColor} 15%, transparent)`,
              }}
            >
              {actor.actorGrade}
            </span>
          )}
          {actor.attributionCountry && (
            <span className="text-[7px] font-mono font-semibold px-1 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-dim)]">
              {actor.attributionCountry}
            </span>
          )}
        </div>
      </div>

      {/* Line 2: Aliases */}
      {aliasesPreview && (
        <div className="text-[8px] font-mono text-[var(--text-dim)] truncate mb-1.5">
          aka {aliasesPreview}
          {extraAliases > 0 && <span className="text-[var(--text-muted)]"> +{extraAliases}</span>}
        </div>
      )}

      {/* Line 3: 5-dim grid */}
      <div className="grid grid-cols-5 gap-1.5">
        <DimCell label="Cap" value={actor.capabilityScore} color={gradeColor} />
        <DimCell label="Reach" value={actor.reachScore} color={gradeColor} />
        <DimCell label="Rec" value={actor.recencyScore} color={gradeColor} />
        <DimCell label="Vel" value={actor.velocityScore} color={gradeColor} />
        <DimCell label="Attr" value={actor.attributionConfidence} color={gradeColor} />
      </div>
    </button>
  );
}

/* ─── ThreatActorScoresPanel ─── */

export function ThreatActorScoresPanel() {
  const [activeTab, setActiveTab] = useState<ActorTypeTab>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('composite');

  const queryOpts = useMemo(
    () => ({
      actorType: activeTab === 'ALL' ? undefined : activeTab.toLowerCase(),
      limit: 50,
    }),
    [activeTab],
  );

  const { isLoading } = useAegisThreatActors(queryOpts);
  const actors = useDataStore((s) => s.threatActors) as unknown as ActorRow[];

  const sortedActors = useMemo(() => {
    const copy = [...actors];
    copy.sort((a, b) => {
      switch (sortBy) {
        case 'recency':
          return (b.recencyScore ?? 0) - (a.recencyScore ?? 0);
        case 'capability':
          return (b.capabilityScore ?? 0) - (a.capabilityScore ?? 0);
        default:
          return (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
      }
    });
    return copy;
  }, [actors, sortBy]);

  const hasData = sortedActors.length > 0;

  return (
    <PanelShell id="threatActorScores" title="THREAT ACTORS" span={2}>
      {/* Filter bar */}
      <div className="flex items-center justify-between gap-1 mb-2 -mt-1 flex-wrap">
        {/* Actor type tabs */}
        <div className="flex items-center gap-0.5 border-b border-[var(--border-subtle)] overflow-x-auto">
          {ACTOR_TYPE_TABS.map((tab) => (
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

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="text-[8px] font-mono bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 cursor-pointer"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              Sort: {SORT_LABELS[opt]}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {isLoading && !hasData ? (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <ShimmerCard key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No threat actors available
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {sortedActors.map((actor) => (
            <ActorCard key={actor.actorId} actor={actor} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

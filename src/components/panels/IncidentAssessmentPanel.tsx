'use client';

import { ArrowLeft, Building2, DollarSign, ShieldX, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useAegisIncidents } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Row shape (from /api/aegis/incidents) ─── */

interface IncidentRow {
  id: number;
  incidentId?: string;
  organization?: string;
  orgDomain?: string;
  industry?: string;
  country?: string;
  disclosedAt?: string;
  incidentType?: string;
  initialAccessVector?: string;
  recordsCompromised?: number;
  estimatedLossUsd?: number;
  summary?: string;
  actorName?: string;
  actorType?: string;
  ttpCount?: number;
  sourceUrl?: string;
}

/* ─── Helpers ─── */

function formatRecords(v: number | undefined): string {
  if (v == null) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toLocaleString();
}

function formatLoss(v: number | undefined): string {
  if (v == null) return '—';
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatIncidentType(t: string | undefined): string {
  if (!t) return 'Unknown';
  return t
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function getIncidentTypeColor(t: string | undefined): string {
  switch (t) {
    case 'ransomware':
      return 'var(--severity-critical)';
    case 'data_breach':
    case 'wiper':
    case 'zero_day':
      return 'var(--severity-high)';
    case 'supply_chain':
    case 'credential_stuffing':
      return 'var(--severity-medium)';
    default:
      return 'var(--severity-low)';
  }
}

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="p-2 rounded border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between mb-1">
        <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <div className="h-2.5 w-3/4 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── Incident List Row ─── */

function IncidentRowItem({
  incident,
  onSelect,
}: {
  incident: IncidentRow;
  onSelect: (id: number) => void;
}) {
  const typeColor = getIncidentTypeColor(incident.incidentType);

  return (
    <button
      type="button"
      onClick={() => onSelect(incident.id)}
      className="w-full text-left p-2 rounded border border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:border-[rgba(var(--crt-glow-rgb),0.3)] cursor-pointer"
    >
      <div className="flex items-center justify-between gap-1.5 mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Building2 size={10} className="shrink-0 text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono font-semibold text-[var(--text-primary)] truncate">
            {incident.organization ?? `Incident #${incident.id}`}
          </span>
        </div>
        <span
          className="text-[7px] font-mono font-bold px-1 py-0.5 rounded shrink-0 uppercase"
          style={{
            color: typeColor,
            backgroundColor: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
          }}
        >
          {formatIncidentType(incident.incidentType)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[8px] font-mono text-[var(--text-dim)] flex-wrap">
        {incident.industry && <span>{incident.industry}</span>}
        {incident.country && <span>{incident.country}</span>}
        {incident.recordsCompromised != null && (
          <span className="text-[var(--severity-medium)]">
            {formatRecords(incident.recordsCompromised)} records
          </span>
        )}
        {incident.disclosedAt && (
          <span className="ml-auto text-[var(--text-muted)]">
            {formatRelativeTime(incident.disclosedAt)}
          </span>
        )}
      </div>
    </button>
  );
}

/* ─── Metric Card ─── */

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  color?: string;
}) {
  return (
    <div className="p-1.5 rounded border border-[var(--border-subtle)]">
      <div className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div className="flex items-center gap-1">
        {Icon && <Icon size={10} className="text-[var(--text-dim)]" />}
        <span
          className="text-[11px] font-mono font-bold tabular-nums"
          style={{ color: color ?? 'var(--text-primary)' }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/* ─── Detail View ─── */

function IncidentDetail({ incident, onBack }: { incident: IncidentRow; onBack: () => void }) {
  const typeColor = getIncidentTypeColor(incident.incidentType);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-[9px] font-mono text-[var(--text-dim)] hover:text-[var(--crt-glow)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={10} />
          Back
        </button>
        <button
          type="button"
          onClick={() =>
            prefillAgent(
              `Analyze the ${incident.organization ?? 'unknown'} ${formatIncidentType(incident.incidentType)} incident. Industry: ${incident.industry ?? 'N/A'}. Records compromised: ${incident.recordsCompromised ?? 'N/A'}. Initial access: ${incident.initialAccessVector ?? 'N/A'}. Provide threat assessment and lessons learned.`,
              {
                sourcePanel: 'incidentAssessment',
                dataType: 'incident',
                trendData: {
                  id: incident.id,
                  organization: incident.organization,
                  industry: incident.industry,
                  country: incident.country,
                  incidentType: incident.incidentType,
                  initialAccessVector: incident.initialAccessVector,
                  recordsCompromised: incident.recordsCompromised,
                  estimatedLossUsd: incident.estimatedLossUsd,
                  actorName: incident.actorName,
                  actorType: incident.actorType,
                  disclosedAt: incident.disclosedAt,
                  summary: incident.summary,
                  sourceUrl: incident.sourceUrl,
                },
              },
            )
          }
          className="text-[8px] font-mono font-semibold text-[var(--crt-glow)] px-2 py-0.5 rounded border border-[var(--crt-glow)] hover:bg-[rgba(var(--crt-glow-rgb),0.1)] transition-colors cursor-pointer"
        >
          ANALYZE
        </button>
      </div>

      {/* Org line */}
      <div>
        <div className="text-[11px] font-mono font-bold text-[var(--text-primary)] mb-0.5 truncate">
          {incident.organization ?? `Incident #${incident.id}`}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[7px] font-mono font-bold px-1.5 py-0.5 rounded uppercase"
            style={{
              color: typeColor,
              backgroundColor: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
            }}
          >
            {formatIncidentType(incident.incidentType)}
          </span>
          {incident.industry && (
            <span className="text-[7px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-dim)]">
              {incident.industry}
            </span>
          )}
          {incident.country && (
            <span className="text-[7px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-dim)]">
              {incident.country}
            </span>
          )}
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-1.5">
        <MetricCard
          label="Records"
          value={formatRecords(incident.recordsCompromised)}
          icon={Users}
          color="var(--severity-medium)"
        />
        <MetricCard
          label="Loss USD"
          value={formatLoss(incident.estimatedLossUsd)}
          icon={DollarSign}
          color="var(--severity-high)"
        />
      </div>

      {/* Attribution */}
      {(incident.actorName || incident.actorType) && (
        <div className="space-y-1">
          <div className="text-[8px] font-mono font-semibold text-[var(--crt-glow)] uppercase tracking-wider">
            Attribution
          </div>
          <div className="p-1.5 rounded border border-[var(--border-subtle)]">
            <div className="flex items-center gap-1.5">
              <ShieldX size={10} className="text-[var(--severity-high)]" />
              <span className="text-[10px] font-mono font-semibold text-[var(--text-primary)]">
                {incident.actorName ?? 'Unknown'}
              </span>
              {incident.actorType && (
                <span className="text-[8px] font-mono uppercase text-[var(--text-dim)] tracking-wider">
                  {incident.actorType}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Initial access vector */}
      {incident.initialAccessVector && (
        <div className="space-y-1">
          <div className="text-[8px] font-mono font-semibold text-[var(--crt-glow)] uppercase tracking-wider">
            Initial Access
          </div>
          <div className="text-[9px] font-mono text-[var(--text-secondary)] p-1.5 rounded border border-[var(--border-subtle)]">
            {incident.initialAccessVector}
          </div>
        </div>
      )}

      {/* Disclosed date */}
      {incident.disclosedAt && (
        <div className="text-[8px] font-mono text-[var(--text-dim)]">
          Disclosed: {formatRelativeTime(incident.disclosedAt)}
        </div>
      )}

      {/* Summary */}
      {incident.summary && (
        <div className="space-y-1">
          <div className="text-[8px] font-mono font-semibold text-[var(--crt-glow)] uppercase tracking-wider">
            Summary
          </div>
          <div className="text-[9px] font-mono text-[var(--text-secondary)] leading-relaxed">
            {incident.summary}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── IncidentAssessmentPanel ─── */

export function IncidentAssessmentPanel() {
  const queryOpts = useMemo(() => ({ limit: 30 }), []);
  const { isLoading } = useAegisIncidents(queryOpts);
  const incidents = useDataStore((s) => s.incidents) as unknown as IncidentRow[];
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selectedIncident = useMemo(
    () => (selectedId != null ? incidents.find((i) => i.id === selectedId) : null),
    [selectedId, incidents],
  );

  const hasData = incidents.length > 0;

  // Detail view
  if (selectedIncident) {
    return (
      <PanelShell id="incidentAssessment" title="INCIDENT ASSESSMENT" span={2}>
        <IncidentDetail incident={selectedIncident} onBack={() => setSelectedId(null)} />
      </PanelShell>
    );
  }

  // List view
  return (
    <PanelShell id="incidentAssessment" title="INCIDENT ASSESSMENT" span={2}>
      {isLoading && !hasData ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No recent incidents
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[8px] font-mono text-[var(--text-dim)] mb-1">
            {incidents.length} incidents (last 90 days) — click to assess
          </div>
          {incidents.map((incident) => (
            <IncidentRowItem
              key={incident.id}
              incident={incident}
              onSelect={(id) => setSelectedId(id)}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

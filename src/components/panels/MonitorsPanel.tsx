'use client';

import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import {
  type Monitor,
  useCreateMonitor,
  useDeleteMonitor,
  useMonitorMatches,
  useMonitors,
  useUpdateMonitor,
} from '@/lib/hooks/use-monitors';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-[var(--severity-critical)]',
  high: 'bg-[var(--severity-high)]',
  medium: 'bg-[var(--severity-medium)]',
  low: 'bg-[var(--severity-low)]',
};

const INPUT_CLASS =
  'w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-info)] focus:outline-none';

/* ─── Monitor row ─── */

/**
 * The hits a watchlist has actually caught.
 *
 * `monitor_match_log` recorded every match from day one and nothing ever read
 * the rows — the operator could see a hit COUNT but never what was hit. Fetched
 * lazily: only the expanded monitor queries.
 */
function MatchList({ monitor }: { monitor: Monitor }) {
  const { data: matches, isLoading } = useMonitorMatches(monitor.id);

  if (isLoading) {
    return <p className="py-1 pl-6 text-[9px] font-mono text-[var(--text-muted)]">Loading hits…</p>;
  }
  if (!matches || matches.length === 0) {
    return (
      <p className="py-1 pl-6 text-[9px] font-mono text-[var(--text-muted)]">
        No hits recorded in the retention window.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5 border-l border-[var(--border-subtle)] pb-1 pl-3 ml-3">
      {matches.map((m) => (
        <li key={m.id} className="group/hit flex items-start gap-1.5">
          <button
            type="button"
            onClick={() =>
              prefillAgent(`Brief me on this watchlist hit: ${m.itemTitle ?? m.itemId}`, {
                sourcePanel: 'monitors',
                dataType: 'monitor_match',
                trendData: {
                  monitor: m.monitorName,
                  matchedKeyword: m.matchedKeyword,
                  source: m.source,
                  title: m.itemTitle,
                  // Rule #21 — Max must be able to cite the item it briefs on.
                  sourceUrl: m.itemUrl,
                },
                timestamp: m.firedAt,
              })
            }
            className="min-w-0 flex-1 py-0.5 text-left"
          >
            <p className="truncate text-[9px] text-[var(--text-secondary)] transition-colors group-hover/hit:text-[var(--color-info)]">
              {m.itemTitle ?? m.itemId}
            </p>
            <p className="truncate text-[8px] font-mono text-[var(--text-muted)]">
              {m.source.toUpperCase()}
              {m.matchedKeyword ? ` · "${m.matchedKeyword}"` : ''} · {formatRelativeTime(m.firedAt)}
            </p>
          </button>
          {m.itemUrl && (
            <a
              href={m.itemUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-1 shrink-0 text-[var(--text-dim)] opacity-0 transition-opacity hover:text-[var(--crt-glow)] group-hover/hit:opacity-100"
              aria-label="Open matched item"
              title="Open matched item"
            >
              <ExternalLink size={9} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function MonitorRow({ monitor }: { monitor: Monitor }) {
  const update = useUpdateMonitor();
  const del = useDeleteMonitor();
  const [expanded, setExpanded] = useState(false);

  const hasHits = monitor.match_count > 0;

  return (
    <div>
      <div className="group flex items-start gap-2 rounded px-1 py-1.5 transition-colors hover:bg-[var(--bg-hover)]">
        <div
          className={cn(
            'mt-[5px] h-2 w-2 shrink-0 rounded-full',
            SEVERITY_DOT[monitor.severity] ?? 'bg-[var(--text-muted)]',
          )}
        />
        {/* Two stacked sibling buttons, not nested — rule #19. The name asks
            Max about the watchlist; the stats line expands its hits. */}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() =>
              prefillAgent(
                `What has my "${monitor.name}" watchlist (${monitor.keywords.join(', ')}) caught recently?`,
                {
                  sourcePanel: 'monitors',
                  dataType: 'monitor',
                  trendData: {
                    monitorId: monitor.id,
                    name: monitor.name,
                    keywords: monitor.keywords,
                    severity: monitor.severity,
                    matchCount: monitor.match_count,
                  },
                },
              )
            }
            className="w-full min-w-0 text-left"
          >
            <p className="truncate text-[var(--text-xs)] text-[var(--text-primary)] transition-colors group-hover:text-[var(--color-info)]">
              {monitor.name}
            </p>
            <p className="mt-0.5 truncate text-[9px] font-mono text-[var(--text-dim)]">
              {monitor.keywords.join(' · ')}
            </p>
          </button>
          {/* Proof of life. Without these the operator can't tell a watchlist
              that has never matched from one the scan has never reached. */}
          <button
            type="button"
            disabled={!hasHits}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            title={hasHits ? 'Show what this watchlist caught' : undefined}
            className={cn(
              'mt-0.5 flex w-full min-w-0 items-center gap-1 text-left',
              hasHits && 'cursor-pointer',
            )}
          >
            {hasHits &&
              (expanded ? (
                <ChevronDown size={9} className="shrink-0 text-[var(--crt-glow)]" />
              ) : (
                <ChevronRight size={9} className="shrink-0 text-[var(--text-dim)]" />
              ))}
            <span className="truncate text-[9px] font-mono text-[var(--text-muted)]">
              {hasHits ? (
                <>
                  <span className="text-[var(--crt-glow)]">
                    {monitor.match_count} hit{monitor.match_count === 1 ? '' : 's'}
                  </span>
                  {monitor.last_match_at && (
                    <> · last {formatRelativeTime(monitor.last_match_at)}</>
                  )}
                </>
              ) : (
                'no hits yet'
              )}
              {monitor.last_scanned_at
                ? ` · scanned ${formatRelativeTime(monitor.last_scanned_at)}`
                : ' · not yet scanned'}
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => update.mutate({ id: monitor.id, patch: { enabled: !monitor.enabled } })}
          title={monitor.enabled ? 'Mute this monitor' : 'Enable this monitor'}
          aria-label={monitor.enabled ? 'Mute monitor' : 'Enable monitor'}
          className={cn(
            'mt-0.5 shrink-0 transition-colors',
            monitor.enabled
              ? 'text-[var(--color-info)] hover:text-[var(--text-secondary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--color-info)]',
          )}
        >
          {monitor.enabled ? <Bell size={11} /> : <BellOff size={11} />}
        </button>
        <button
          type="button"
          onClick={() => del.mutate(monitor.id)}
          title="Delete monitor"
          aria-label="Delete monitor"
          className="mt-0.5 shrink-0 text-[var(--text-dim)] opacity-0 transition-opacity hover:text-[var(--color-negative)] group-hover:opacity-100"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && hasHits && <MatchList monitor={monitor} />}
    </div>
  );
}

/* ─── Add form ─── */

function AddMonitorForm({ onClose }: { onClose: () => void }) {
  const create = useCreateMonitor();
  const [name, setName] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [severity, setSeverity] = useState<string>('medium');

  const keywords = keywordsText
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const canSubmit = name.trim().length > 0 && keywords.length > 0 && !create.isPending;

  function submit() {
    if (!canSubmit) return;
    create.mutate(
      { name: name.trim(), keywords, severity },
      {
        onSuccess: () => {
          setName('');
          setKeywordsText('');
          setSeverity('medium');
          onClose();
        },
      },
    );
  }

  return (
    <div className="mb-2 space-y-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Monitor name (e.g. My Vendors)"
        className={INPUT_CLASS}
      />
      <input
        value={keywordsText}
        onChange={(e) => setKeywordsText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Keywords, comma-separated (Fortinet, LockBit, CVE-2026)"
        className={INPUT_CLASS}
      />
      <div className="flex items-center gap-1.5">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-1.5 py-1 text-[9px] font-mono uppercase text-[var(--text-secondary)] focus:border-[var(--color-info)] focus:outline-none"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded border border-[var(--color-info)]/40 px-2 py-1 text-[9px] font-mono font-semibold uppercase tracking-wide text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {create.isPending ? 'Saving…' : 'Create'}
        </button>
      </div>
      {create.isError && (
        <p className="text-[9px] font-mono text-[var(--color-negative)]">
          Could not save — sign in to manage watchlists.
        </p>
      )}
    </div>
  );
}

/* ─── MonitorsPanel ─── */

export function MonitorsPanel() {
  const { data: monitors, isLoading } = useMonitors();
  const [showForm, setShowForm] = useState(false);
  const list = monitors ?? [];

  return (
    <PanelShell id="monitors" title="MY MONITORS" span={1}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-dim)]">
          {list.length} watchlist{list.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:text-[var(--color-info)]"
        >
          {showForm ? <X size={11} /> : <Plus size={11} />}
          {showForm ? 'Close' : 'Add'}
        </button>
      </div>

      {showForm && <AddMonitorForm onClose={() => setShowForm(false)} />}

      {isLoading && list.length === 0 ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">Loading monitors…</span>
        </div>
      ) : list.length === 0 && !showForm ? (
        <div className="flex h-full min-h-[100px] flex-col items-center justify-center gap-2 text-center">
          <Search size={16} className="text-[var(--text-muted)]" />
          <p className="max-w-[200px] text-[10px] font-mono leading-relaxed text-[var(--text-muted)]">
            Track vendors, CVEs, or threat actors. Hits land on the ALERTS board every 5 minutes;
            high and critical watchlists also get a briefing from Max.
          </p>
        </div>
      ) : (
        <div className="space-y-0">
          {list.map((m) => (
            <MonitorRow key={m.id} monitor={m} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

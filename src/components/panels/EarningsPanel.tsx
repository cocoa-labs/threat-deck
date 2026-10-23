'use client';

import { ExternalLink } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useEarningsData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { EarningsEvent } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Section Grouping ─── */

type Section = 'RECENT RESULTS' | 'THIS WEEK' | 'NEXT WEEK';

function groupIntoSections(events: EarningsEvent[]): Record<Section, EarningsEvent[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // End of current week (Sunday)
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()));

  // End of next week
  const endOfNextWeek = new Date(endOfWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  const groups: Record<Section, EarningsEvent[]> = {
    'RECENT RESULTS': [],
    'THIS WEEK': [],
    'NEXT WEEK': [],
  };

  for (const event of events) {
    if (event.isPast) {
      groups['RECENT RESULTS'].push(event);
      continue;
    }

    const d = new Date(`${event.reportDate}T00:00:00`);
    if (d <= endOfWeek) {
      groups['THIS WEEK'].push(event);
    } else if (d <= endOfNextWeek) {
      groups['NEXT WEEK'].push(event);
    }
    // Events beyond next week are excluded
  }

  return groups;
}

/* ─── Formatting Helpers ─── */

function formatReportDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRevenue(val: number | null): string {
  if (val == null) return '\u2014';
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function formatEps(val: number | null): string {
  if (val == null) return '\u2014';
  return `$${val.toFixed(2)}`;
}

/* ─── Hour Badge ─── */

function HourBadge({ hour }: { hour: string | null }) {
  if (!hour) return null;
  const label = hour.toUpperCase();
  if (label !== 'BMO' && label !== 'AMC' && label !== 'DMH') return null;
  return (
    <span className="text-[7px] font-mono font-semibold text-[var(--text-muted)] bg-[var(--bg-hover)] px-1 py-px rounded shrink-0">
      {label}
    </span>
  );
}

/* ─── BEAT/MISS Badge ─── */

function SurpriseBadge({ surprisePercent }: { surprisePercent: number | null }) {
  if (surprisePercent == null) return null;
  const isBeat = surprisePercent > 0;
  return (
    <span
      className={cn(
        'text-[7px] font-mono font-bold px-1.5 py-px rounded shrink-0',
        isBeat
          ? 'text-[var(--color-positive)] bg-[var(--color-positive)]/10'
          : 'text-[var(--color-negative)] bg-[var(--color-negative)]/10',
      )}
    >
      {isBeat ? 'BEAT' : 'MISS'} {isBeat ? '+' : ''}
      {surprisePercent.toFixed(1)}%
    </span>
  );
}

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="flex items-center gap-3 py-1.5 px-2">
      <div className="h-3 w-14 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-3 w-10 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-hover)] flex-1" />
      <div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── Click Handlers ─── */

function handlePastClick(event: EarningsEvent) {
  const parts: string[] = [`Analyze ${event.name} (${event.symbol}) earnings results.`];
  if (event.epsActual !== null && event.estimate !== null) {
    parts.push(
      `Reported EPS ${formatEps(event.epsActual)} vs estimate ${formatEps(event.estimate)}.`,
    );
  }
  if (event.surprisePercent !== null) {
    parts.push(
      `Surprise: ${event.surprisePercent > 0 ? '+' : ''}${event.surprisePercent.toFixed(1)}%.`,
    );
  }
  if (event.revenueActual !== null) {
    parts.push(
      `Revenue: ${formatRevenue(event.revenueActual)}${event.revenueEstimate !== null ? ` vs est ${formatRevenue(event.revenueEstimate)}` : ''}.`,
    );
  }

  prefillAgent(parts.join(' '), {
    sourcePanel: 'earnings',
    dataType: 'earnings_result',
    trendData: {
      symbol: event.symbol,
      name: event.name,
      reportDate: event.reportDate,
      estimate: event.estimate,
      epsActual: event.epsActual,
      surprisePercent: event.surprisePercent,
      revenueEstimate: event.revenueEstimate,
      revenueActual: event.revenueActual,
      hour: event.hour,
      sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(event.symbol)}/`,
    },
  });
}

function handleUpcomingClick(event: EarningsEvent) {
  const parts: string[] = [`Analyze upcoming ${event.name} (${event.symbol}) earnings.`];
  if (event.estimate !== null) {
    parts.push(`Consensus EPS estimate: ${formatEps(event.estimate)}.`);
  }
  if (event.revenueEstimate !== null) {
    parts.push(`Revenue estimate: ${formatRevenue(event.revenueEstimate)}.`);
  }
  if (event.hour) {
    parts.push(`Reports ${event.hour.toUpperCase()} on ${event.reportDate}.`);
  } else {
    parts.push(`Reports on ${event.reportDate}.`);
  }
  parts.push('What should we watch for?');

  prefillAgent(parts.join(' '), {
    sourcePanel: 'earnings',
    dataType: 'earnings_event',
    trendData: {
      symbol: event.symbol,
      name: event.name,
      reportDate: event.reportDate,
      estimate: event.estimate,
      revenueEstimate: event.revenueEstimate,
      hour: event.hour,
      quarter: event.quarter,
      year: event.year,
      sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(event.symbol)}/`,
    },
  });
}

/* ─── Major Row (Past) ─── */

function MajorPastRow({ event }: { event: EarningsEvent }) {
  return (
    <button
      type="button"
      onClick={() => handlePastClick(event)}
      className={cn(
        'flex items-center gap-2 py-2 px-2 rounded-[var(--radius-sm)] cursor-pointer transition-colors text-left w-full',
        'hover:bg-[var(--bg-hover)]',
        'border-l-2 border-[var(--crt-glow)]',
      )}
    >
      {/* Date */}
      <span className="text-[9px] font-mono text-[var(--text-muted)] w-12 shrink-0 tabular-nums">
        {formatReportDate(event.reportDate)}
      </span>

      {/* Symbol */}
      <span className="text-[10px] font-mono font-bold text-[var(--text-primary)] w-12 shrink-0">
        {event.symbol}
      </span>

      {/* Name */}
      <span className="text-[9px] font-mono text-[var(--text-dim)] truncate flex-1 min-w-0">
        {event.name}
      </span>

      {/* EPS: estimate → actual */}
      {event.estimate !== null && event.epsActual !== null && (
        <span className="text-[8px] font-mono tabular-nums shrink-0">
          <span className="text-[var(--text-muted)]">{formatEps(event.estimate)}</span>
          <span className="text-[var(--text-dim)] mx-0.5">{'\u2192'}</span>
          <span
            className={cn(
              event.epsActual >= event.estimate
                ? 'text-[var(--color-positive)]'
                : 'text-[var(--color-negative)]',
            )}
          >
            {formatEps(event.epsActual)}
          </span>
        </span>
      )}

      {/* BEAT/MISS badge */}
      <SurpriseBadge surprisePercent={event.surprisePercent} />

      {/* External link */}
      <a
        href={`https://finance.yahoo.com/quote/${encodeURIComponent(event.symbol)}/`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors shrink-0"
      >
        <ExternalLink size={9} />
      </a>
    </button>
  );
}

/* ─── Major Row (Upcoming) ─── */

function MajorUpcomingRow({ event }: { event: EarningsEvent }) {
  return (
    <button
      type="button"
      onClick={() => handleUpcomingClick(event)}
      className={cn(
        'flex items-center gap-2 py-2 px-2 rounded-[var(--radius-sm)] cursor-pointer transition-colors text-left w-full',
        'hover:bg-[var(--bg-hover)]',
        'border-l-2 border-[var(--crt-glow)]',
      )}
    >
      {/* Date */}
      <span className="text-[9px] font-mono text-[var(--text-muted)] w-12 shrink-0 tabular-nums">
        {formatReportDate(event.reportDate)}
      </span>

      {/* Symbol */}
      <span className="text-[10px] font-mono font-bold text-[var(--text-primary)] w-12 shrink-0">
        {event.symbol}
      </span>

      {/* Hour badge */}
      <HourBadge hour={event.hour} />

      {/* Name */}
      <span className="text-[9px] font-mono text-[var(--text-dim)] truncate flex-1 min-w-0">
        {event.name}
      </span>

      {/* EPS estimate */}
      <span className="text-[9px] font-mono text-[var(--text-secondary)] tabular-nums shrink-0">
        {formatEps(event.estimate)}
      </span>

      {/* Revenue estimate */}
      {event.revenueEstimate !== null && (
        <span className="text-[8px] font-mono text-[var(--text-muted)] tabular-nums shrink-0">
          {formatRevenue(event.revenueEstimate)}
        </span>
      )}

      {/* External link */}
      <a
        href={`https://finance.yahoo.com/quote/${encodeURIComponent(event.symbol)}/`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors shrink-0"
      >
        <ExternalLink size={9} />
      </a>
    </button>
  );
}

/* ─── Minor Row ─── */

function MinorRow({ event }: { event: EarningsEvent }) {
  const handleClick = event.isPast ? handlePastClick : handleUpcomingClick;
  return (
    <button
      type="button"
      onClick={() => handleClick(event)}
      className={cn(
        'flex items-center gap-2 py-1 px-2 rounded-[var(--radius-sm)] cursor-pointer transition-colors text-left w-full opacity-60',
        'hover:bg-[var(--bg-hover)] hover:opacity-80',
      )}
    >
      {/* Date */}
      <span className="text-[8px] font-mono text-[var(--text-muted)] w-12 shrink-0 tabular-nums">
        {formatReportDate(event.reportDate)}
      </span>

      {/* Symbol */}
      <span className="text-[9px] font-mono font-bold text-[var(--text-primary)] w-12 shrink-0">
        {event.symbol}
      </span>

      {/* Name (truncated) */}
      <span className="text-[8px] font-mono text-[var(--text-dim)] truncate flex-1 min-w-0">
        {event.name}
      </span>

      {/* EPS estimate only */}
      <span className="text-[8px] font-mono text-[var(--text-muted)] tabular-nums shrink-0">
        {formatEps(event.estimate)}
      </span>

      {/* External link */}
      <a
        href={`https://finance.yahoo.com/quote/${encodeURIComponent(event.symbol)}/`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors shrink-0"
      >
        <ExternalLink size={8} />
      </a>
    </button>
  );
}

/* ─── EarningsPanel ─── */

export function EarningsPanel() {
  const { isLoading } = useEarningsData();
  const earnings = useDataStore((s) => s.earnings);

  const hasData = earnings.length > 0;

  const grouped = hasData ? groupIntoSections(earnings) : null;
  const sectionOrder: Section[] = ['RECENT RESULTS', 'THIS WEEK', 'NEXT WEEK'];

  return (
    <PanelShell id="earnings" title="EARNINGS CALENDAR" span={1}>
      {isLoading && !hasData ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No earnings data available
          </span>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {sectionOrder.map((section) => {
            const events = grouped?.[section];
            if (!events || events.length === 0) return null;

            const isResults = section === 'RECENT RESULTS';

            return (
              <div key={section}>
                {/* Section header */}
                <div className="px-2 py-0.5">
                  <span
                    className={cn(
                      'text-[8px] font-mono font-semibold uppercase tracking-[0.15em]',
                      isResults ? 'text-[var(--crt-glow)]' : 'text-[var(--text-dim)]',
                    )}
                  >
                    {section}
                  </span>
                </div>

                {/* Rows */}
                {events.map((event) => {
                  if (!event.isMajor) {
                    return <MinorRow key={event.id} event={event} />;
                  }
                  if (event.isPast) {
                    return <MajorPastRow key={event.id} event={event} />;
                  }
                  return <MajorUpcomingRow key={event.id} event={event} />;
                })}

                {/* Revenue line for past results section */}
                {isResults && events.some((e) => e.revenueActual !== null) && (
                  <div className="px-2 pt-1 pb-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {events
                      .filter((e) => e.isMajor && e.revenueActual !== null)
                      .map((e) => (
                        <span
                          key={`rev-${e.id}`}
                          className="text-[7px] font-mono text-[var(--text-muted)]"
                        >
                          {e.symbol} rev: {formatRevenue(e.revenueActual)}
                          {e.revenueEstimate !== null && (
                            <span className="text-[var(--text-dim)]">
                              {' '}
                              vs {formatRevenue(e.revenueEstimate)}
                            </span>
                          )}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}

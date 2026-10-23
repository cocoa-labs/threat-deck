'use client';

import { ExternalLink, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { enrichIndicatorsWithForecasts } from '@/lib/data/enrich-indicators';
import { useFedCalendarData, useFedData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { FedCalendarEvent } from '@/lib/types';
import { handleKeyActivation } from '@/lib/utils/a11y';
import { cn } from '@/lib/utils/cn';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── FRED Series URLs ─── */

const FRED_URLS: Record<string, string> = {
  balanceSheet: 'https://fred.stlouisfed.org/series/WALCL',
  m2: 'https://fred.stlouisfed.org/series/M2SL',
  fedFunds: 'https://fred.stlouisfed.org/series/FEDFUNDS',
  unemployment: 'https://fred.stlouisfed.org/series/UNRATE',
  gdp: 'https://fred.stlouisfed.org/series/GDP',
  cpi: 'https://fred.stlouisfed.org/series/CPIAUCSL',
  pce: 'https://fred.stlouisfed.org/series/PCEPI',
  treasury10Y: 'https://fred.stlouisfed.org/series/DGS10',
  yieldSpread: 'https://fred.stlouisfed.org/series/T10Y2Y',
  initialClaims: 'https://fred.stlouisfed.org/series/ICSA',
  industrialProduction: 'https://fred.stlouisfed.org/series/INDPRO',
  consumerSentiment: 'https://fred.stlouisfed.org/series/UMCSENT',
  retailSales: 'https://fred.stlouisfed.org/series/RSXFS',
  housingStarts: 'https://fred.stlouisfed.org/series/HOUST',
};

/* ─── Helpers ─── */

function formatTrillions(value: number): string {
  const t = value / 1_000_000;
  if (t >= 1) return `$${t.toFixed(1)}T`;
  return `$${(value / 1_000).toFixed(0)}B`;
}

function formatBillions(value: number): string {
  const b = value / 1_000;
  if (b >= 1) return `$${b.toFixed(1)}T`;
  return `$${value.toFixed(0)}B`;
}

function formatChangePercent(change: number): { text: string; isPositive: boolean } {
  const prefix = change >= 0 ? '+' : '';
  return {
    text: `${prefix}${change.toFixed(2)}%`,
    isPositive: change >= 0,
  };
}

function formatRate(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatIndex(value: number): string {
  return value.toFixed(1);
}

function formatThousands(value: number): string {
  return `${(value / 1_000).toFixed(0)}K`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCalendarDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatCalendarDateShort(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ─── Shimmer ─── */

function ShimmerCard() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 space-y-1.5">
      <div className="h-2.5 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-4 w-14 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-2 w-20 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── KPI Card ─── */

function KpiCard({
  label,
  value,
  change,
  date,
  onClick,
  url,
  isDemo,
  nextForecast,
  nextReleaseDate,
}: {
  label: string;
  value: string;
  change?: { text: string; isPositive: boolean };
  date: string;
  onClick?: () => void;
  url?: string;
  isDemo?: boolean;
  nextForecast?: string;
  nextReleaseDate?: string;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: onClick is conditionally provided; role and keyboard handling are added when interactive
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? handleKeyActivation(onClick) : undefined}
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5',
        onClick && 'cursor-pointer transition-colors hover:bg-[var(--bg-hover)]',
        isDemo && 'opacity-60',
      )}
    >
      {/* Label + external link */}
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-mono font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
          {label}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors"
          >
            <ExternalLink size={9} />
          </a>
        )}
      </div>

      {/* Value */}
      <div className="flex flex-wrap items-baseline gap-1 mt-0.5">
        <span className="text-sm font-mono font-bold text-[var(--text-primary)] tabular-nums">
          {value}
        </span>
        {change && (
          <div className="flex items-center gap-0.5">
            {change.isPositive ? (
              <TrendingUp size={8} className="text-[var(--color-positive)]" />
            ) : (
              <TrendingDown size={8} className="text-[var(--color-negative)]" />
            )}
            <span
              className={cn(
                'text-[8px] font-mono font-medium tabular-nums',
                change.isPositive ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]',
              )}
            >
              {change.text}
            </span>
          </div>
        )}
      </div>

      {/* Date + EST badge for demo data */}
      <span className="text-[7px] font-mono text-[var(--text-muted)] mt-0.5 block">
        {date}
        {isDemo && (
          <span className="text-[6px] font-mono text-[var(--color-warning)] ml-1">EST</span>
        )}
      </span>

      {/* Next release forecast (from Finnhub calendar) */}
      {nextForecast && (
        <span className="text-[7px] font-mono text-[var(--text-muted)] mt-0.5 block">
          <span className="text-[var(--text-dim)]">Est:</span>{' '}
          <span className="text-[var(--crt-glow)]">{nextForecast}</span>
          {nextReleaseDate && (
            <span className="text-[var(--text-dim)] ml-1">
              ({formatCalendarDateShort(nextReleaseDate)})
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/* ─── Impact Dot ─── */

function ImpactDot({ impact }: { impact: FedCalendarEvent['impact'] }) {
  const color =
    impact === 'HIGH'
      ? 'bg-[var(--color-negative)]'
      : impact === 'MEDIUM'
        ? 'bg-[var(--color-warning)]'
        : 'bg-[var(--text-muted)]';
  return <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', color)} />;
}

/* ─── Beat/Miss Detection ─── */

function getActualColor(actual: string, forecast: string, invert?: boolean): string | null {
  const actualNum = Number.parseFloat(actual.replace(/[^-\d.]/g, ''));
  const forecastNum = Number.parseFloat(forecast.replace(/[^-\d.]/g, ''));
  if (Number.isNaN(actualNum) || Number.isNaN(forecastNum)) return null;
  if (invert) {
    // For inflation: higher actual = bearish (red), lower actual = bullish (green)
    if (actualNum > forecastNum) return 'text-[var(--color-negative)]';
    if (actualNum < forecastNum) return 'text-[var(--color-positive)]';
  } else {
    if (actualNum > forecastNum) return 'text-[var(--color-positive)]';
    if (actualNum < forecastNum) return 'text-[var(--color-negative)]';
  }
  return null;
}

/* ─── Surprise Badge ─── */

function SurpriseBadge({ surprisePercent, invert }: { surprisePercent: number; invert?: boolean }) {
  const isPositive = surprisePercent > 0;
  const prefix = isPositive ? '+' : '';
  // For inflation releases, positive surprise (higher than expected) is bearish (red)
  const isBullish = invert ? !isPositive : isPositive;
  const color = isBullish ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]';
  return (
    <span
      className={cn(
        'text-[6px] font-mono font-bold px-0.5 rounded tabular-nums',
        color,
        isBullish ? 'bg-[var(--color-positive)]/10' : 'bg-[var(--color-negative)]/10',
      )}
    >
      {prefix}
      {surprisePercent.toFixed(1)}%
    </span>
  );
}

/* ─── Enrichment Line ─── */

function EnrichmentLine({ event }: { event: FedCalendarEvent }) {
  const hasPrev = event.previous != null && event.previous !== '';
  const hasForecast = event.forecast != null && event.forecast !== '';
  const hasActual = event.actual != null && event.actual !== '';
  const hasSurprise = event.surprisePercent != null && event.surprisePercent !== 0;

  if (!hasPrev && !hasForecast && !hasActual) return null;

  const actualColor =
    hasActual && hasForecast
      ? getActualColor(event.actual!, event.forecast!, event.invertBeatMiss)
      : null;

  return (
    <div className="flex items-center gap-1.5 pl-5.5 text-[7px] font-mono text-[var(--text-muted)]">
      {hasPrev && (
        <span>
          <span className="text-[var(--text-dim)]">Prev:</span>{' '}
          <span className="text-[var(--text-secondary)]">{event.previous}</span>
        </span>
      )}
      {hasPrev && (hasForecast || hasActual) && <span className="text-[var(--text-dim)]">|</span>}
      {hasForecast && (
        <span>
          <span className="text-[var(--text-dim)]">Est:</span>{' '}
          <span className="text-[var(--text-secondary)]">{event.forecast}</span>
        </span>
      )}
      {hasForecast && hasActual && <span className="text-[var(--text-dim)]">|</span>}
      {hasActual && (
        <span>
          <span className="text-[var(--text-dim)]">Act:</span>{' '}
          <span className={actualColor ?? 'text-[var(--text-secondary)]'}>{event.actual}</span>
        </span>
      )}
      {hasActual && hasSurprise && (
        <SurpriseBadge surprisePercent={event.surprisePercent!} invert={event.invertBeatMiss} />
      )}
    </div>
  );
}

/* ─── Calendar View ─── */

function FedCalendarView({ events }: { events: FedCalendarEvent[] }) {
  // Whitelist filtering is now done at the collector level — show all events
  if (events.length === 0) {
    return (
      <div className="flex h-full min-h-[80px] items-center justify-center">
        <span className="text-[10px] font-mono text-[var(--text-muted)]">No upcoming releases</span>
      </div>
    );
  }

  // Sort: today first, then future (ascending), then past (descending / most recent first)
  const todayEvents = events.filter((e) => e.isToday);
  const futureEvents = events
    .filter((e) => !e.isToday && !e.isPast)
    .sort((a, b) => a.date.localeCompare(b.date));
  const pastEvents = events
    .filter((e) => e.isPast && !e.isToday)
    .sort((a, b) => b.date.localeCompare(a.date));
  const sorted = [...todayEvents, ...futureEvents, ...pastEvents];

  // Group events by date (preserving sort order)
  const grouped: [string, FedCalendarEvent[]][] = [];
  for (const event of sorted) {
    const last = grouped[grouped.length - 1];
    if (last && last[0] === event.date) {
      last[1].push(event);
    } else {
      grouped.push([event.date, [event]]);
    }
  }

  // Find index of first past group for divider
  const firstPastIdx = grouped.findIndex(([, evts]) => evts[0]?.isPast && !evts[0]?.isToday);

  return (
    <div className="space-y-1.5 overflow-y-auto">
      {grouped.map(([date, dateEvents], idx) => {
        const isToday = dateEvents[0]?.isToday;
        const isPast = dateEvents[0]?.isPast;

        return (
          <div key={date}>
            {/* Past section divider */}
            {idx === firstPastIdx && (
              <div className="flex items-center gap-2 px-1.5 pt-2 pb-1">
                <div className="h-px flex-1 bg-[var(--border-subtle)]" />
                <span className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                  Past Releases
                </span>
                <div className="h-px flex-1 bg-[var(--border-subtle)]" />
              </div>
            )}
            {/* Date header */}
            <div
              className={cn(
                'flex items-center gap-1.5 px-1.5 py-0.5',
                isToday && 'bg-[var(--crt-glow)]/10 rounded-[var(--radius-sm)]',
              )}
            >
              <span
                className={cn(
                  'text-[8px] font-mono font-semibold uppercase tracking-[0.1em]',
                  isToday
                    ? 'text-[var(--crt-glow)]'
                    : isPast
                      ? 'text-[var(--text-muted)]'
                      : 'text-[var(--text-dim)]',
                )}
              >
                {formatCalendarDate(date)}
              </span>
              {isToday && (
                <span className="text-[7px] font-mono font-bold text-[var(--crt-glow)] tracking-wider animate-pulse">
                  TODAY
                </span>
              )}
            </div>

            {/* Events for this date */}
            {dateEvents.map((event) => {
              const sourceLink = `https://fred.stlouisfed.org/release?rid=${event.releaseId}`;

              return (
                // biome-ignore lint/a11y/useSemanticElements: nested <a> inside interactive container prevents using <button>
                <div
                  key={`${event.releaseId}-${event.date}`}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    prefillAgent(
                      `Brief me on the upcoming ${event.releaseName} release on ${formatCalendarDate(event.date)}.${event.previous ? ` Previous: ${event.previous}.` : ''}${event.forecast ? ` Forecast: ${event.forecast}.` : ''}${event.actual ? ` Actual: ${event.actual}.` : ''} What should markets expect?`,
                      {
                        sourcePanel: 'fed',
                        dataType: 'fed_calendar_event',
                        trendData: {
                          releaseName: event.releaseName,
                          releaseId: event.releaseId,
                          date: event.date,
                          impact: event.impact,
                          category: event.category,
                          previous: event.previous,
                          forecast: event.forecast,
                          actual: event.actual,
                          time: event.time,
                          sourceUrl: sourceLink,
                        },
                      },
                    )
                  }
                  onKeyDown={handleKeyActivation(() =>
                    prefillAgent(
                      `Brief me on the upcoming ${event.releaseName} release on ${formatCalendarDate(event.date)}.${event.previous ? ` Previous: ${event.previous}.` : ''}${event.forecast ? ` Forecast: ${event.forecast}.` : ''}${event.actual ? ` Actual: ${event.actual}.` : ''} What should markets expect?`,
                      {
                        sourcePanel: 'fed',
                        dataType: 'fed_calendar_event',
                        trendData: {
                          releaseName: event.releaseName,
                          releaseId: event.releaseId,
                          date: event.date,
                          impact: event.impact,
                          category: event.category,
                          previous: event.previous,
                          forecast: event.forecast,
                          actual: event.actual,
                          time: event.time,
                          sourceUrl: sourceLink,
                        },
                      },
                    ),
                  )}
                  className={cn(
                    'px-2 py-1 cursor-pointer rounded-[var(--radius-sm)]',
                    'hover:bg-[var(--bg-hover)]',
                    isToday && 'border border-[var(--crt-glow)]/30',
                    isPast && !isToday && 'opacity-50',
                  )}
                >
                  {/* Line 1: Impact dot, name, reference, source link, impact label */}
                  <div className="flex items-center gap-2">
                    <ImpactDot impact={event.impact} />
                    <span
                      className={cn(
                        'text-[9px] font-mono flex-1 truncate',
                        isToday ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                      )}
                    >
                      {event.releaseName}
                      {event.reference && (
                        <span className="ml-1 text-[7px] text-[var(--crt-glow)]">
                          {event.reference}
                        </span>
                      )}
                      {event.time && (
                        <span className="text-[7px] font-mono text-[var(--crt-glow)] ml-1">
                          {event.time}
                        </span>
                      )}
                    </span>
                    <a
                      href={sourceLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="text-[var(--text-muted)] hover:text-[var(--color-info)] shrink-0"
                    >
                      <ExternalLink size={9} />
                    </a>
                    <span
                      className={cn(
                        'text-[7px] font-mono uppercase tracking-wider shrink-0',
                        event.impact === 'HIGH'
                          ? 'text-[var(--color-negative)]'
                          : event.impact === 'MEDIUM'
                            ? 'text-[var(--color-warning)]'
                            : 'text-[var(--text-muted)]',
                      )}
                    >
                      {event.impact}
                    </span>
                  </div>
                  {/* Line 2: Prev / Est / Act (only when enrichment data exists) */}
                  <EnrichmentLine event={event} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ─── FedPanel (Economic Indicators) ─── */

export function FedPanel() {
  const { isLoading } = useFedData();
  useFedCalendarData();
  const fedData = useDataStore((s) => s.fedData);
  const fedCalendar = useDataStore((s) => s.fedCalendar);
  const [activeTab, setActiveTab] = useState<'indicators' | 'calendar'>('indicators');

  // Enrich indicators with forecast data from calendar events
  const enrichedFedData = useMemo(() => {
    if (!fedData || fedCalendar.length === 0) return fedData;
    return enrichIndicatorsWithForecasts({ ...fedData }, fedCalendar);
  }, [fedData, fedCalendar]);

  const hasData = fedData !== null;
  const forecasts = enrichedFedData?._forecasts;

  return (
    <PanelShell id="fed" title="ECONOMIC INDICATORS" span={2}>
      {/* Tab toggle + stale-data badge */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex gap-0 border border-[var(--border-subtle)] rounded-[var(--radius-sm)] w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('indicators')}
            className={cn(
              'px-2 py-0.5 text-[8px] font-mono font-semibold uppercase tracking-[0.1em]',
              'rounded-l-[var(--radius-sm)]',
              activeTab === 'indicators'
                ? 'bg-[var(--crt-glow)]/15 text-[var(--crt-glow)] border-r border-[var(--border-subtle)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-r border-[var(--border-subtle)]',
            )}
          >
            Indicators
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('calendar')}
            className={cn(
              'px-2 py-0.5 text-[8px] font-mono font-semibold uppercase tracking-[0.1em]',
              'rounded-r-[var(--radius-sm)]',
              activeTab === 'calendar'
                ? 'bg-[var(--crt-glow)]/15 text-[var(--crt-glow)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            )}
          >
            Releases
          </button>
        </div>
        {fedData?.stale && (
          <span
            className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-1.5 py-0.5 text-[8px] font-mono font-semibold uppercase tracking-[0.1em] text-[var(--color-warning)]"
            title="FRED is degraded — showing last-known-good data, not live"
          >
            {fedData._demo ? 'Sample data' : 'Stale · FRED degraded'}
          </span>
        )}
      </div>

      {activeTab === 'indicators' ? (
        isLoading && !hasData ? (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
          >
            {Array.from({ length: 14 }).map((_, i) => (
              <ShimmerCard key={i} />
            ))}
          </div>
        ) : !hasData ? (
          <div className="flex h-full min-h-[80px] items-center justify-center">
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              No economic data available
            </span>
          </div>
        ) : (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
          >
            {/* Row 1: Monetary & Rates */}

            {/* Balance Sheet */}
            {fedData.balanceSheet && (
              <KpiCard
                label="Fed Balance Sheet"
                value={formatTrillions(fedData.balanceSheet.value)}
                change={formatChangePercent(fedData.balanceSheet.change)}
                date={formatDate(fedData.balanceSheet.date)}
                url={FRED_URLS.balanceSheet}
                isDemo={fedData._demoKeys?.includes('balanceSheet')}
                nextForecast={forecasts?.balanceSheet?.forecast}
                nextReleaseDate={forecasts?.balanceSheet?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `Analyze the current Fed balance sheet at ${formatTrillions(fedData.balanceSheet!.value)} (${formatChangePercent(fedData.balanceSheet!.change).text}). What are the implications for markets and liquidity?`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'balanceSheet',
                        value: fedData.balanceSheet!.value,
                        change: fedData.balanceSheet!.change,
                        date: fedData.balanceSheet!.date,
                        sourceUrl: FRED_URLS.balanceSheet,
                      },
                    },
                  )
                }
              />
            )}

            {/* M2 Money Supply */}
            {fedData.m2 && (
              <KpiCard
                label="M2 Supply"
                value={formatBillions(fedData.m2.value)}
                change={formatChangePercent(fedData.m2.change)}
                date={formatDate(fedData.m2.date)}
                url={FRED_URLS.m2}
                isDemo={fedData._demoKeys?.includes('m2')}
                nextForecast={forecasts?.m2?.forecast}
                nextReleaseDate={forecasts?.m2?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `Analyze M2 money supply at ${formatBillions(fedData.m2!.value)} (${formatChangePercent(fedData.m2!.change).text}). What does this signal about monetary policy and inflation?`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'm2',
                        value: fedData.m2!.value,
                        change: fedData.m2!.change,
                        date: fedData.m2!.date,
                        sourceUrl: FRED_URLS.m2,
                      },
                    },
                  )
                }
              />
            )}

            {/* Fed Funds Rate */}
            {fedData.fedFunds && (
              <KpiCard
                label="Fed Funds Rate"
                value={formatRate(fedData.fedFunds.value)}
                date={formatDate(fedData.fedFunds.date)}
                url={FRED_URLS.fedFunds}
                isDemo={fedData._demoKeys?.includes('fedFunds')}
                nextForecast={forecasts?.fedFunds?.forecast}
                nextReleaseDate={forecasts?.fedFunds?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `The Fed Funds rate is at ${formatRate(fedData.fedFunds!.value)}. What's the outlook for rate changes and how does this affect equity and bond markets?`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'fedFunds',
                        value: fedData.fedFunds!.value,
                        date: fedData.fedFunds!.date,
                        sourceUrl: FRED_URLS.fedFunds,
                      },
                    },
                  )
                }
              />
            )}

            {/* 10Y Treasury */}
            {fedData.treasury10Y && (
              <KpiCard
                label="10Y Treasury"
                value={formatRate(fedData.treasury10Y.value)}
                date={formatDate(fedData.treasury10Y.date)}
                url={FRED_URLS.treasury10Y}
                isDemo={fedData._demoKeys?.includes('treasury10Y')}
                nextForecast={forecasts?.treasury10Y?.forecast}
                nextReleaseDate={forecasts?.treasury10Y?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `The 10-Year Treasury yield is at ${formatRate(fedData.treasury10Y!.value)}. Analyze the bond market outlook and implications for equities and fixed income.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'treasury10Y',
                        value: fedData.treasury10Y!.value,
                        date: fedData.treasury10Y!.date,
                        sourceUrl: FRED_URLS.treasury10Y,
                      },
                    },
                  )
                }
              />
            )}

            {/* Yield Spread (10Y-2Y) */}
            {fedData.yieldSpread && (
              <KpiCard
                label="10Y-2Y Spread"
                value={`${fedData.yieldSpread.value.toFixed(2)}%`}
                change={
                  fedData.yieldSpread.value < 0
                    ? { text: 'INVERTED', isPositive: false }
                    : undefined
                }
                date={formatDate(fedData.yieldSpread.date)}
                url={FRED_URLS.yieldSpread}
                isDemo={fedData._demoKeys?.includes('yieldSpread')}
                nextForecast={forecasts?.yieldSpread?.forecast}
                nextReleaseDate={forecasts?.yieldSpread?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `The 10Y-2Y yield spread is at ${fedData.yieldSpread!.value.toFixed(2)}%. ${fedData.yieldSpread!.value < 0 ? 'The curve is inverted — recession signal.' : 'The curve is positive.'} Analyze recession probability and market implications.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'yieldSpread',
                        value: fedData.yieldSpread!.value,
                        date: fedData.yieldSpread!.date,
                        sourceUrl: FRED_URLS.yieldSpread,
                      },
                    },
                  )
                }
              />
            )}

            {/* Row 2: Economic Activity & Labor */}

            {/* GDP */}
            {fedData.gdp && (
              <KpiCard
                label="GDP"
                value={`$${(fedData.gdp.value / 1_000).toFixed(1)}T`}
                change={formatChangePercent(fedData.gdp.change)}
                date={formatDate(fedData.gdp.date)}
                url={FRED_URLS.gdp}
                isDemo={fedData._demoKeys?.includes('gdp')}
                nextForecast={forecasts?.gdp?.forecast}
                nextReleaseDate={forecasts?.gdp?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `US GDP is at $${(fedData.gdp!.value / 1_000).toFixed(1)}T (${formatChangePercent(fedData.gdp!.change).text}). Analyze economic growth trajectory and implications for markets.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'gdp',
                        value: fedData.gdp!.value,
                        change: fedData.gdp!.change,
                        date: fedData.gdp!.date,
                        sourceUrl: FRED_URLS.gdp,
                      },
                    },
                  )
                }
              />
            )}

            {/* CPI */}
            {fedData.cpi && (
              <KpiCard
                label="CPI (YoY)"
                value={formatRate(fedData.cpi.value)}
                change={formatChangePercent(fedData.cpi.change)}
                date={formatDate(fedData.cpi.date)}
                url={FRED_URLS.cpi}
                isDemo={fedData._demoKeys?.includes('cpi')}
                nextForecast={forecasts?.cpi?.forecast}
                nextReleaseDate={forecasts?.cpi?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `CPI inflation is at ${formatRate(fedData.cpi!.value)} YoY (${formatChangePercent(fedData.cpi!.change).text} vs prior month). Analyze inflation trends and implications for Fed policy and asset prices.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'cpi',
                        value: fedData.cpi!.value,
                        change: fedData.cpi!.change,
                        date: fedData.cpi!.date,
                        sourceUrl: FRED_URLS.cpi,
                      },
                    },
                  )
                }
              />
            )}

            {/* PCE */}
            {fedData.pce && (
              <KpiCard
                label="PCE (YoY)"
                value={formatRate(fedData.pce.value)}
                change={formatChangePercent(fedData.pce.change)}
                date={formatDate(fedData.pce.date)}
                url={FRED_URLS.pce}
                isDemo={fedData._demoKeys?.includes('pce')}
                nextForecast={forecasts?.pce?.forecast}
                nextReleaseDate={forecasts?.pce?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `PCE inflation is at ${formatRate(fedData.pce!.value)} YoY (${formatChangePercent(fedData.pce!.change).text} vs prior month). This is the Fed's preferred inflation gauge — analyze what it signals for monetary policy.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'pce',
                        value: fedData.pce!.value,
                        change: fedData.pce!.change,
                        date: fedData.pce!.date,
                        sourceUrl: FRED_URLS.pce,
                      },
                    },
                  )
                }
              />
            )}

            {/* Unemployment Rate */}
            {fedData.unemployment && (
              <KpiCard
                label="Unemployment"
                value={formatRate(fedData.unemployment.value)}
                date={formatDate(fedData.unemployment.date)}
                url={FRED_URLS.unemployment}
                isDemo={fedData._demoKeys?.includes('unemployment')}
                nextForecast={forecasts?.unemployment?.forecast}
                nextReleaseDate={forecasts?.unemployment?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `Unemployment is at ${formatRate(fedData.unemployment!.value)}. Analyze labor market conditions and implications for Fed policy.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'unemployment',
                        value: fedData.unemployment!.value,
                        date: fedData.unemployment!.date,
                        sourceUrl: FRED_URLS.unemployment,
                      },
                    },
                  )
                }
              />
            )}

            {/* Initial Claims */}
            {fedData.initialClaims && (
              <KpiCard
                label="Initial Claims"
                value={formatThousands(fedData.initialClaims.value)}
                change={formatChangePercent(fedData.initialClaims.change)}
                date={formatDate(fedData.initialClaims.date)}
                url={FRED_URLS.initialClaims}
                isDemo={fedData._demoKeys?.includes('initialClaims')}
                nextForecast={forecasts?.initialClaims?.forecast}
                nextReleaseDate={forecasts?.initialClaims?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `Initial jobless claims are at ${formatThousands(fedData.initialClaims!.value)} (${formatChangePercent(fedData.initialClaims!.change).text}). Analyze labor market momentum and recession risk.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'initialClaims',
                        value: fedData.initialClaims!.value,
                        change: fedData.initialClaims!.change,
                        date: fedData.initialClaims!.date,
                        sourceUrl: FRED_URLS.initialClaims,
                      },
                    },
                  )
                }
              />
            )}

            {/* Row 3: New Indicators */}

            {/* Industrial Production */}
            {fedData.industrialProduction && (
              <KpiCard
                label="Industrial Prod"
                value={formatIndex(fedData.industrialProduction.value)}
                change={formatChangePercent(fedData.industrialProduction.change)}
                date={formatDate(fedData.industrialProduction.date)}
                url={FRED_URLS.industrialProduction}
                isDemo={fedData._demoKeys?.includes('industrialProduction')}
                nextForecast={forecasts?.industrialProduction?.forecast}
                nextReleaseDate={forecasts?.industrialProduction?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `Industrial Production Index is at ${formatIndex(fedData.industrialProduction!.value)} (${formatChangePercent(fedData.industrialProduction!.change).text}). Analyze manufacturing and industrial output trends and market implications.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'industrialProduction',
                        value: fedData.industrialProduction!.value,
                        change: fedData.industrialProduction!.change,
                        date: fedData.industrialProduction!.date,
                        sourceUrl: FRED_URLS.industrialProduction,
                      },
                    },
                  )
                }
              />
            )}

            {/* Consumer Sentiment */}
            {fedData.consumerSentiment && (
              <KpiCard
                label="Consumer Sent."
                value={formatIndex(fedData.consumerSentiment.value)}
                change={formatChangePercent(fedData.consumerSentiment.change)}
                date={formatDate(fedData.consumerSentiment.date)}
                url={FRED_URLS.consumerSentiment}
                isDemo={fedData._demoKeys?.includes('consumerSentiment')}
                nextForecast={forecasts?.consumerSentiment?.forecast}
                nextReleaseDate={forecasts?.consumerSentiment?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `University of Michigan Consumer Sentiment is at ${formatIndex(fedData.consumerSentiment!.value)} (${formatChangePercent(fedData.consumerSentiment!.change).text}). Analyze consumer confidence trends and spending outlook.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'consumerSentiment',
                        value: fedData.consumerSentiment!.value,
                        change: fedData.consumerSentiment!.change,
                        date: fedData.consumerSentiment!.date,
                        sourceUrl: FRED_URLS.consumerSentiment,
                      },
                    },
                  )
                }
              />
            )}

            {/* Retail Sales */}
            {fedData.retailSales && (
              <KpiCard
                label="Retail Sales"
                value={formatBillions(fedData.retailSales.value)}
                change={formatChangePercent(fedData.retailSales.change)}
                date={formatDate(fedData.retailSales.date)}
                url={FRED_URLS.retailSales}
                isDemo={fedData._demoKeys?.includes('retailSales')}
                nextForecast={forecasts?.retailSales?.forecast}
                nextReleaseDate={forecasts?.retailSales?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `Advance Retail Sales (ex food services) is at ${formatBillions(fedData.retailSales!.value)} (${formatChangePercent(fedData.retailSales!.change).text}). Analyze consumer spending trends and economic health.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'retailSales',
                        value: fedData.retailSales!.value,
                        change: fedData.retailSales!.change,
                        date: fedData.retailSales!.date,
                        sourceUrl: FRED_URLS.retailSales,
                      },
                    },
                  )
                }
              />
            )}

            {/* Housing Starts */}
            {fedData.housingStarts && (
              <KpiCard
                label="Housing Starts"
                value={`${fedData.housingStarts.value.toFixed(0)}K`}
                change={formatChangePercent(fedData.housingStarts.change)}
                date={formatDate(fedData.housingStarts.date)}
                url={FRED_URLS.housingStarts}
                isDemo={fedData._demoKeys?.includes('housingStarts')}
                nextForecast={forecasts?.housingStarts?.forecast}
                nextReleaseDate={forecasts?.housingStarts?.releaseDate}
                onClick={() =>
                  prefillAgent(
                    `Housing Starts are at ${fedData.housingStarts!.value.toFixed(0)}K (${formatChangePercent(fedData.housingStarts!.change).text}). Analyze housing market conditions and implications for the broader economy.`,
                    {
                      sourcePanel: 'fed',
                      dataType: 'economic_indicator',
                      trendData: {
                        indicator: 'housingStarts',
                        value: fedData.housingStarts!.value,
                        change: fedData.housingStarts!.change,
                        date: fedData.housingStarts!.date,
                        sourceUrl: FRED_URLS.housingStarts,
                      },
                    },
                  )
                }
              />
            )}
          </div>
        )
      ) : (
        <FedCalendarView events={fedCalendar} />
      )}
    </PanelShell>
  );
}

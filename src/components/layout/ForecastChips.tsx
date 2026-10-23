'use client';

/**
 * Phase 11.D.12 — Header forecast chips: FORECAST RISK + TREND.
 *
 * Polls /api/aegis/predictions/situation every 60s for the aggregate-30d
 * exploit probability + 7-day KEV-add trend label. Renders two clickable
 * chips alongside the existing CRT / KEV chips in the Header CyberChip row.
 *
 * Click behaviour:
 *   - FORECAST RISK → opens AgentDrawer prefilled with a 30d top-5 brief
 *   - TREND → opens AgentDrawer prefilled with a trend-driver explainer
 *
 * Visual chrome matches CyberChip exactly so the Header stays cohesive.
 * Color codes:
 *   - aggregate30dP ≥ 0.30 → critical red
 *   - 0.10 ≤ aggregate30dP < 0.30 → warning amber
 *   - otherwise → matrix green default
 *
 *   - trend 'rising' → critical red ↑
 *   - trend 'flat' → muted →
 *   - trend 'falling' → matrix green ↓
 */

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils/cn';
import { prefillAgent } from '@/lib/utils/panel-actions';

const POLL_INTERVAL_MS = 60_000;
const STALE_MS = 30_000;

interface SituationResponse {
  ok: boolean;
  signal: {
    aggregate30dP: number;
    kevTrendLabel: 'rising' | 'flat' | 'falling';
    kev7dProjection: number;
    computedAt: string;
  } | null;
}

export function ForecastChips(): React.JSX.Element {
  const { data } = useQuery<SituationResponse>({
    queryKey: ['situation-signal'],
    queryFn: async () => {
      const res = await fetch('/api/aegis/predictions/situation');
      if (!res.ok) throw new Error(`situation ${res.status}`);
      return (await res.json()) as SituationResponse;
    },
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: STALE_MS,
  });

  const signal = data?.signal;
  const aggregate = signal?.aggregate30dP ?? 0;
  const trend = signal?.kevTrendLabel ?? 'flat';
  const projection = signal?.kev7dProjection ?? 0;

  const riskTone = aggregate >= 0.3 ? 'critical' : aggregate >= 0.1 ? 'warning' : 'default';
  const trendTone = trend === 'rising' ? 'critical' : trend === 'falling' ? 'good' : 'default';
  const trendGlyph = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';

  const handleRiskClick = () => {
    prefillAgent(
      'Summarize the 30-day exploitation forecast. Walk through the top 5 most-likely CVEs by P(exploited), name the model used, and call out the main drivers.',
      {
        sourcePanel: 'header-forecast-risk',
        dataType: 'situationSignal',
        trendData: {
          aggregate30dP: aggregate,
          kevTrendLabel: trend,
          kev7dProjection: projection,
          sourceUrl: '/api/aegis/predictions/situation',
        },
      },
    );
  };

  const handleTrendClick = () => {
    prefillAgent(
      "What's driving the recent trend in CISA KEV-add rate? Reason from the Kalman-filter 7-day projection and any recent advisories that might be elevating activity.",
      {
        sourcePanel: 'header-forecast-trend',
        dataType: 'trendSignal',
        trendData: {
          kevTrendLabel: trend,
          kev7dProjection: projection,
          aggregate30dP: aggregate,
          sourceUrl: '/api/aegis/predictions/timeseries?metric=kev_adds&horizonDays=7',
        },
      },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={handleRiskClick}
        title={`Aggregate P(exploited 30d) across top-20 likely CVEs · Model: exploit-logistic-v0_1`}
        className={cn(
          'flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded px-2 py-0.5',
          'hover:brightness-125 transition-[filter] cursor-pointer',
          'border border-transparent hover:border-[rgba(255,255,255,0.08)]',
        )}
      >
        <span className="text-[var(--text-secondary)] text-[10px] font-mono">FORECAST</span>
        <span
          className={cn(
            'text-[11px] font-mono font-semibold tabular-nums',
            riskTone === 'critical' && 'text-[var(--severity-critical,_var(--color-negative))]',
            riskTone === 'warning' && 'text-[var(--color-warning)]',
            riskTone === 'default' && 'text-[var(--matrix-green,#00ff41)]',
          )}
        >
          {(aggregate * 100).toFixed(1)}%
        </span>
      </button>
      <button
        type="button"
        onClick={handleTrendClick}
        title={`KEV-add 7-day trend · Kalman projection: ${projection.toFixed(2)}/day · Model: timeseries-kalman-v0_1`}
        className={cn(
          'flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded px-2 py-0.5',
          'hover:brightness-125 transition-[filter] cursor-pointer',
          'border border-transparent hover:border-[rgba(255,255,255,0.08)]',
        )}
      >
        <span className="text-[var(--text-secondary)] text-[10px] font-mono">TREND</span>
        <span
          className={cn(
            'text-[11px] font-mono font-semibold',
            trendTone === 'critical' && 'text-[var(--severity-critical,_var(--color-negative))]',
            trendTone === 'good' && 'text-[var(--matrix-green,#00ff41)]',
            trendTone === 'default' && 'text-[var(--text-muted)]',
          )}
        >
          {trendGlyph}
        </span>
      </button>
    </>
  );
}

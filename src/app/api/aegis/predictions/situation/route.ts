import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.D — Situation signal endpoint (Header chips).
 *
 * GET /api/aegis/predictions/situation
 *
 * Single-row read of `aegis_v_situation_signal` (Phase 11.0 view) plus
 * an on-demand Kalman fit for the 7-day kev_adds trend. Polled every
 * ~60s by the Header's FORECAST RISK + TREND chips.
 *
 * Fast — view is pre-aggregated, Kalman fit runs against the 90-day
 * trailing window (typically <50ms).
 *
 * Returns:
 *   - aggregate30dP    : mean P(exploited 30d) across top-20 likely CVEs
 *   - kevTrendLabel    : 'rising' | 'flat' | 'falling'
 *   - kev7dProjection  : Kalman median projection for next 7 days
 *   - computedAt       : ISO timestamp for cache-busting / staleness
 */

import { NextResponse } from 'next/server';
import { type DailyValue, forecastMetric } from '@/lib/aegis/forecasting/timeseries-kalman';
import { query } from '@/lib/db/client';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

interface SituationRow {
  next_30d_aggregate_p: string;
  kev_trend_label: string;
  kev_7d_projection: string;
  computed_at: string;
}

interface RouteResponse {
  ok: boolean;
  signal: {
    aggregate30dP: number;
    kevTrendLabel: 'rising' | 'flat' | 'falling';
    kev7dProjection: number;
    computedAt: string;
  } | null;
  error?: string;
}

async function handleGet(_request: Request): Promise<NextResponse<RouteResponse>> {
  try {
    // 1. Pre-aggregated view (cheap)
    const { rows } = await query<SituationRow>(`SELECT * FROM aegis_v_situation_signal`);
    const baseline = rows[0];
    if (!baseline) {
      return NextResponse.json<RouteResponse>({ ok: true, signal: null });
    }

    // 2. Live Kalman fit for the 7-day kev_adds trend (view's
    //    timeseries_forecasts is empty until the daily-forecast cron
    //    populates it — until then, compute on the fly here).
    const { rows: histRows } = await query<{ date: string; value: number }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, kev_adds AS value
         FROM aegis_daily_metrics
         WHERE date >= CURRENT_DATE - INTERVAL '90 days'
         ORDER BY date ASC`,
    );
    const history: DailyValue[] = histRows.map((r) => ({
      date: r.date,
      value: Number(r.value) || 0,
    }));
    const liveForecast = history.length >= 5 ? forecastMetric('kev_adds', history, 7) : null;

    const trendLabel = liveForecast
      ? liveForecast.trend
      : (baseline.kev_trend_label as 'rising' | 'flat' | 'falling');
    const projection = liveForecast
      ? (liveForecast.forecast[6]?.pMid ?? Number(baseline.kev_7d_projection))
      : Number(baseline.kev_7d_projection);

    return NextResponse.json<RouteResponse>({
      ok: true,
      signal: {
        aggregate30dP: Number(baseline.next_30d_aggregate_p),
        kevTrendLabel: trendLabel,
        kev7dProjection: projection,
        computedAt: baseline.computed_at,
      },
    });
  } catch (err) {
    return NextResponse.json<RouteResponse>({
      ok: false,
      signal: null,
      error: err instanceof Error ? err.message : 'situation_failed',
    });
  }
}

// Phase 13 Tier 3 — Per-IP rate-limit. Header chip polls every 30s; cap
// at 240/min covers worst-case multi-tab analyst while blocking abuse.
const routeGETImplementation = withRateLimit(handleGet, {
  key: (req: Request) => `predictions-situation:${getClientIp(req)}`,
  limit: 240,
  windowMs: 60_000,
});

export const GET = withRoutePolicy('/api/aegis/predictions/situation', routeGETImplementation);

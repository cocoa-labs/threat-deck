import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.D — Time-series Kalman forecast endpoint.
 *
 * GET /api/aegis/predictions/timeseries?metric=kev_adds&horizonDays=30
 *
 * Reads daily counts from aegis_daily_metrics (Phase 11.A.4 populates this
 * via the 03:00 UTC cron). Fits a local-level + local-trend Kalman filter
 * and returns the projection + trend classification + 95% predictive bands.
 *
 * Used by:
 *   - PredictionsPanel TIMESERIES view (4 sparklines per metric)
 *   - Header TREND chip (calls metric=kev_adds horizonDays=7)
 *
 * Defaults: metric=kev_adds, horizonDays=30. Bounded to plan-decided
 * horizons {7, 30, 90} to keep CI sensible.
 */

import { NextResponse } from 'next/server';
import {
  type DailyValue,
  forecastMetric,
  METRICS,
  type Metric,
  type TimeSeriesForecast,
} from '@/lib/aegis/forecasting/timeseries-kalman';
import { query } from '@/lib/db/client';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

const ALLOWED_HORIZONS: readonly number[] = [7, 30, 90];

interface RouteResponse {
  ok: boolean;
  metric: Metric | null;
  horizonDays: number | null;
  forecast: TimeSeriesForecast | null;
  sampleSize: number;
  sourceUrl: string | null;
  error?: string;
}

async function handleGet(request: Request): Promise<NextResponse<RouteResponse>> {
  const { searchParams } = new URL(request.url);
  const metricParam = (searchParams.get('metric') ?? 'kev_adds') as Metric;
  const horizonParam = Number.parseInt(searchParams.get('horizonDays') ?? '30', 10);
  const sourceUrl = `/api/aegis/cves/view?id=trend-${metricParam}`;

  if (!(METRICS as readonly string[]).includes(metricParam)) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        metric: null,
        horizonDays: null,
        forecast: null,
        sampleSize: 0,
        sourceUrl,
        error: 'invalid_metric',
      },
      { status: 400 },
    );
  }
  if (!ALLOWED_HORIZONS.includes(horizonParam)) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        metric: metricParam,
        horizonDays: null,
        forecast: null,
        sampleSize: 0,
        sourceUrl,
        error: 'invalid_horizon',
      },
      { status: 400 },
    );
  }

  try {
    // Pull the trailing 365d of daily counts for the requested metric.
    // The Kalman filter wants a continuous gap-free series — the
    // aggregations cron's zero-fill (Phase 11.A.4) guarantees this.
    const { rows } = await query<{ date: string; value: number }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, ${metricParam} AS value
         FROM aegis_daily_metrics
         WHERE date >= CURRENT_DATE - INTERVAL '365 days'
         ORDER BY date ASC`,
    );
    const history: DailyValue[] = rows.map((r) => ({
      date: r.date,
      value: Number(r.value) || 0,
    }));

    const forecast = forecastMetric(metricParam, history, horizonParam);

    return NextResponse.json<RouteResponse>({
      ok: true,
      metric: metricParam,
      horizonDays: horizonParam,
      forecast,
      sampleSize: history.length,
      sourceUrl,
    });
  } catch (err) {
    return NextResponse.json<RouteResponse>({
      ok: false,
      metric: metricParam,
      horizonDays: horizonParam,
      forecast: null,
      sampleSize: 0,
      sourceUrl,
      error: err instanceof Error ? err.message : 'forecast_failed',
    });
  }
}

// Phase 13 Tier 3 — Per-IP rate-limit. DB-only read; cheap. 60/min/IP.
const routeGETImplementation = withRateLimit(handleGet, {
  key: (req: Request) => `predictions-timeseries:${getClientIp(req)}`,
  limit: 60,
  windowMs: 60_000,
});

export const GET = withRoutePolicy('/api/aegis/predictions/timeseries', routeGETImplementation);

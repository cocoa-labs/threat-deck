import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.D.16 — Outcome backfill cron.
 *
 * Vercel cron at 05:00 UTC daily. Walks forecasts older than 30 days
 * that DON'T yet have an outcome row, looks up the ground truth, and
 * INSERTs into aegis_forecast_outcomes with Brier + log-loss + the
 * was_correct label.
 *
 * Per-kind outcome resolution:
 *
 *   cve_logistic    → Did the CVE enter KEV within 30 days of forecast_date?
 *                     was_correct = (p_exploited_30d > 0.5) === (kev_added)
 *                     Brier = (p - outcome)^2, log_loss = -[y log p + (1-y) log (1-p)]
 *
 *   cve_lifecycle   → Did the predicted "next state" (argmax beyond current)
 *                     match the actual lifecycle transition?
 *                     Defer to "skip" for v0.1 — needs paired observation
 *                     stream we don't yet have a way to mine.
 *
 *   actor_target    → Did the actor target any sector in the predicted top-5
 *                     within 30 days of forecast_date?
 *                     Brier on the predicted probability of the realized sector.
 *
 *   timeseries      → Was the realized metric value within the 95% predictive
 *                     interval? Brier = squared error between p_mid and actual.
 *
 *   causal          → Counterfactuals are unfalsifiable. We INSERT outcome
 *                     rows with was_correct=NULL just to track that we saw
 *                     them — calibration metrics aren't meaningful.
 *
 * Auth: checkCronSecret. Fail-soft 200 with per-kind error tally. Idempotent
 * via UNIQUE(forecast_kind, forecast_id, model_version, outcome_observed_at).
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { query } from '@/lib/db/client';

const OUTCOME_WINDOW_DAYS = 30;
const LOG_FLOOR = 1e-6;

interface RouteResponse {
  ok: boolean;
  outcomes: {
    cveLogistic: number;
    actorTarget: number;
    timeseries: number;
  };
  ms: number;
  errors: string[];
}

async function routePOSTImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runOutcomes(request);
}
async function routeGETImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runOutcomes(request);
}

async function runOutcomes(request: Request): Promise<NextResponse<RouteResponse>> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        outcomes: { cveLogistic: 0, actorTarget: 0, timeseries: 0 },
        ms: 0,
        errors: [auth.reason ?? 'auth failed'],
      },
      { status: 401 },
    );
  }

  const start = Date.now();
  const errors: string[] = [];
  const outcomes = { cveLogistic: 0, actorTarget: 0, timeseries: 0 };

  try {
    outcomes.cveLogistic = await labelCveLogisticOutcomes();
  } catch (e) {
    errors.push(`cve_logistic: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    outcomes.actorTarget = await labelActorTargetOutcomes();
  } catch (e) {
    errors.push(`actor_target: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    outcomes.timeseries = await labelTimeseriesOutcomes();
  } catch (e) {
    errors.push(`timeseries: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json<RouteResponse>({
    ok: errors.length === 0,
    outcomes,
    ms: Date.now() - start,
    errors,
  });
}

// ─── CVE logistic outcomes ──────────────────────────────────────────────────

interface CveForecastRow {
  id: string;
  cve_id: string;
  forecast_date: string;
  model_version: string;
  p_exploited_30d: string;
}

async function labelCveLogisticOutcomes(): Promise<number> {
  const { rows } = await query<CveForecastRow>(
    `SELECT f.id::text AS id,
            f.cve_id,
            TO_CHAR(f.forecast_date, 'YYYY-MM-DD') AS forecast_date,
            f.model_version,
            f.p_exploited_30d::text AS p_exploited_30d
       FROM aegis_cve_forecasts f
       LEFT JOIN aegis_forecast_outcomes o
         ON o.forecast_kind = 'cve_logistic'
        AND o.forecast_id = f.id
        AND o.model_version = f.model_version
       WHERE f.forecast_date <= CURRENT_DATE - INTERVAL '$1 days'
         AND o.id IS NULL
       LIMIT 500`.replace('$1', String(OUTCOME_WINDOW_DAYS)),
  );
  let labeled = 0;
  for (const forecast of rows) {
    const p = Number(forecast.p_exploited_30d);
    // Outcome window: was the CVE added to KEV within OUTCOME_WINDOW_DAYS
    // of the forecast date?
    const { rows: kevRows } = await query<{ added_to_kev_at: string }>(
      `SELECT added_to_kev_at FROM aegis_kev WHERE cve_id = $1 LIMIT 1`,
      [forecast.cve_id],
    );
    let y: 0 | 1 = 0;
    let observedAt = new Date().toISOString();
    if (kevRows.length > 0) {
      const kevDate = Date.parse(kevRows[0]!.added_to_kev_at);
      const forecastDateMs = Date.parse(forecast.forecast_date);
      const deltaDays = (kevDate - forecastDateMs) / (1000 * 60 * 60 * 24);
      if (deltaDays >= 0 && deltaDays <= OUTCOME_WINDOW_DAYS) {
        y = 1;
        observedAt = kevRows[0]!.added_to_kev_at;
      }
    }
    const brier = (p - y) * (p - y);
    const clampedP = Math.max(LOG_FLOOR, Math.min(1 - LOG_FLOOR, p));
    const logLoss = -(y * Math.log(clampedP) + (1 - y) * Math.log(1 - clampedP));
    const wasCorrect = p > 0.5 === (y === 1);
    const r = await query(
      `INSERT INTO aegis_forecast_outcomes
         (forecast_kind, forecast_id, model_version, outcome_observed_at,
          was_correct, brier_score, log_loss, evidence_json)
       VALUES ('cve_logistic', $1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        Number(forecast.id),
        forecast.model_version,
        observedAt,
        wasCorrect,
        brier,
        logLoss,
        JSON.stringify({ pPredicted: p, yObserved: y, cveId: forecast.cve_id }),
      ],
    );
    if (r.rowCount && r.rowCount > 0) labeled++;
  }
  return labeled;
}

// ─── Actor target outcomes ──────────────────────────────────────────────────

interface ActorForecastRow {
  id: string;
  actor_id: string;
  forecast_date: string;
  model_version: string;
  top_sectors_json: string;
}

async function labelActorTargetOutcomes(): Promise<number> {
  const { rows } = await query<ActorForecastRow>(
    `SELECT f.id::text AS id,
            f.actor_id,
            TO_CHAR(f.forecast_date, 'YYYY-MM-DD') AS forecast_date,
            f.model_version,
            f.top_sectors_json::text AS top_sectors_json
       FROM aegis_actor_target_forecasts f
       LEFT JOIN aegis_forecast_outcomes o
         ON o.forecast_kind = 'actor_target'
        AND o.forecast_id = f.id
        AND o.model_version = f.model_version
       WHERE f.forecast_date <= CURRENT_DATE - INTERVAL '$1 days'
         AND o.id IS NULL
       LIMIT 500`.replace('$1', String(OUTCOME_WINDOW_DAYS)),
  );

  let labeled = 0;
  for (const forecast of rows) {
    let topSectors: Array<{ category: string; pMean: number }> = [];
    try {
      topSectors = JSON.parse(forecast.top_sectors_json) as Array<{
        category: string;
        pMean: number;
      }>;
    } catch {
      // bad JSON — skip
      continue;
    }
    const top5 = topSectors.slice(0, 5).map((s) => s.category);

    // Did the actor target any of the top-5 predicted sectors within the window?
    const { rows: hits } = await query<{ industry: string }>(
      `SELECT DISTINCT industry FROM aegis_threat_actor_targets
         WHERE actor_id = $1
           AND industry = ANY($2)
           AND created_at::timestamptz >= ($3::date)::timestamptz
           AND created_at::timestamptz <= ($3::date)::timestamptz + INTERVAL '$4 days'`.replace(
        '$4',
        String(OUTCOME_WINDOW_DAYS),
      ),
      [forecast.actor_id, top5, forecast.forecast_date],
    );

    let y: 0 | 1 = 0;
    let realizedSector: string | null = null;
    let pRealized = 0;
    if (hits.length > 0) {
      y = 1;
      realizedSector = hits[0]!.industry;
      pRealized = topSectors.find((s) => s.category === realizedSector)?.pMean ?? 0;
    }
    // Brier on the realized sector's predicted probability (or 0 if no hit)
    const brier = (pRealized - y) * (pRealized - y);
    const clampedP = Math.max(LOG_FLOOR, Math.min(1 - LOG_FLOOR, pRealized || LOG_FLOOR));
    const logLoss = -(y * Math.log(clampedP) + (1 - y) * Math.log(1 - clampedP));
    const wasCorrect = y === 1;
    const r = await query(
      `INSERT INTO aegis_forecast_outcomes
         (forecast_kind, forecast_id, model_version, outcome_observed_at,
          was_correct, brier_score, log_loss, evidence_json)
       VALUES ('actor_target', $1, $2, NOW(), $3, $4, $5, $6::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        Number(forecast.id),
        forecast.model_version,
        wasCorrect,
        brier,
        logLoss,
        JSON.stringify({
          actorId: forecast.actor_id,
          top5Predicted: top5,
          realizedSector,
          pRealized,
        }),
      ],
    );
    if (r.rowCount && r.rowCount > 0) labeled++;
  }
  return labeled;
}

// ─── Time-series outcomes ───────────────────────────────────────────────────

interface TsForecastRow {
  id: string;
  metric_name: string;
  forecast_date: string;
  horizon_days: number;
  model_version: string;
  p_low: string;
  p_mid: string;
  p_high: string;
}

async function labelTimeseriesOutcomes(): Promise<number> {
  // Pick metric forecasts whose horizon has now elapsed
  const { rows } = await query<TsForecastRow>(
    `SELECT f.id::text AS id,
            f.metric_name,
            TO_CHAR(f.forecast_date, 'YYYY-MM-DD') AS forecast_date,
            f.horizon_days,
            f.model_version,
            f.p_low::text AS p_low,
            f.p_mid::text AS p_mid,
            f.p_high::text AS p_high
       FROM aegis_timeseries_forecasts f
       LEFT JOIN aegis_forecast_outcomes o
         ON o.forecast_kind = 'timeseries'
        AND o.forecast_id = f.id
        AND o.model_version = f.model_version
       WHERE f.forecast_date + (f.horizon_days * INTERVAL '1 day') <= CURRENT_DATE
         AND o.id IS NULL
       LIMIT 500`,
  );

  let labeled = 0;
  for (const forecast of rows) {
    const { rows: metricRows } = await query<{ value: string }>(
      `SELECT ${forecast.metric_name}::text AS value
         FROM aegis_daily_metrics
         WHERE date = ($1::date + ($2 * INTERVAL '1 day'))::date
         LIMIT 1`,
      [forecast.forecast_date, forecast.horizon_days],
    );
    if (metricRows.length === 0) continue;
    const actual = Number(metricRows[0]!.value);
    const low = Number(forecast.p_low);
    const mid = Number(forecast.p_mid);
    const high = Number(forecast.p_high);
    const wasCorrect = actual >= low && actual <= high;
    // Brier-style: normalized squared error vs the midpoint, capped at 1
    const span = Math.max(1, high - low);
    const brier = Math.min(1, ((actual - mid) / span) ** 2);
    // log_loss not meaningful for continuous-valued forecasts — store NULL
    const r = await query(
      `INSERT INTO aegis_forecast_outcomes
         (forecast_kind, forecast_id, model_version, outcome_observed_at,
          was_correct, brier_score, evidence_json)
       VALUES ('timeseries', $1, $2, NOW(), $3, $4, $5::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        Number(forecast.id),
        forecast.model_version,
        wasCorrect,
        brier,
        JSON.stringify({
          metric: forecast.metric_name,
          horizonDays: forecast.horizon_days,
          forecastDate: forecast.forecast_date,
          predicted: { low, mid, high },
          actual,
        }),
      ],
    );
    if (r.rowCount && r.rowCount > 0) labeled++;
  }
  return labeled;
}

export const POST = withRoutePolicy('/api/aegis/forecast-outcomes', routePOSTImplementation);
export const GET = withRoutePolicy('/api/aegis/forecast-outcomes', routeGETImplementation);

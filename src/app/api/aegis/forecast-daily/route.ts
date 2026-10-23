import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.D.16 — Daily forecast cron.
 *
 * Vercel cron at 11:00 UTC daily. Runs ALL five model families for the
 * eligible entity universe and UPSERTs into the aegis_*_forecasts tables.
 * The PredictionsPanel's pre-computed views read from these tables for
 * faster paint than the live on-demand routes.
 *
 * Algorithm:
 *
 *   1. LOGISTIC — for every non-KEV CVE published in the last 365d that
 *      has a CVSS score, run forecastExploit and UPSERT a row keyed on
 *      (cve_id, forecast_date, model_version). Bounded to top-200 by
 *      CVSS so cron stays under 60s on the no-API-key dev tier.
 *
 *   2. HMM — for every CVE with ≥1 severity_history event, run
 *      inferCveState and UPSERT into aegis_cve_lifecycle_states.
 *
 *   3. BAYESIAN — for every actor with at least 1 target row, run
 *      forecastFromObservations over its target categories. UPSERT
 *      into aegis_actor_target_forecasts.
 *
 *   4. TIMESERIES — for each metric ∈ {kev_adds, incidents, breaches,
 *      advisories, geo_events} × horizon ∈ {7, 30, 90}, fit Kalman and
 *      UPSERT into aegis_timeseries_forecasts.
 *
 *   5. CAUSAL — refresh the situation signal view (driven by step 4's
 *      kev_adds 7d forecast).
 *
 * Auth: `checkCronSecret` (same pattern as forecast-aggregations).
 * Idempotency: every UPSERT keyed on (entity, forecast_date,
 * model_version) — re-runs the same day produce zero net effect.
 *
 * Fail-soft: ALWAYS returns 200. Per-model failures captured into
 * `errors` array but the cron doesn't bail.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import {
  aggregateObservations,
  forecastFromObservations,
} from '@/lib/aegis/forecasting/actor-target-bayesian';
import {
  EMISSIONS,
  type Emission,
  inferCveState,
  loadDefaultModel as loadHmmModel,
} from '@/lib/aegis/forecasting/cve-lifecycle-hmm';
import {
  type ExploitFeatures,
  forecastExploit,
  loadDefaultModel as loadLogisticModel,
} from '@/lib/aegis/forecasting/exploit-logistic';
import {
  type DailyValue,
  forecastMetric,
  METRICS,
  type Metric,
} from '@/lib/aegis/forecasting/timeseries-kalman';
import { query } from '@/lib/db/client';

const TOP_CVE_LIMIT = 200;
const HORIZONS: readonly number[] = [7, 30, 90];

interface RouteResponse {
  ok: boolean;
  counts: {
    cveForecasts: number;
    actorForecasts: number;
    lifecycleStates: number;
    timeseriesForecasts: number;
  };
  ms: number;
  errors: string[];
}

async function routePOSTImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runDaily(request);
}
async function routeGETImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runDaily(request);
}

async function runDaily(request: Request): Promise<NextResponse<RouteResponse>> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        counts: { cveForecasts: 0, actorForecasts: 0, lifecycleStates: 0, timeseriesForecasts: 0 },
        ms: 0,
        errors: [auth.reason ?? 'auth failed'],
      },
      { status: 401 },
    );
  }

  const start = Date.now();
  const errors: string[] = [];
  const counts = {
    cveForecasts: 0,
    actorForecasts: 0,
    lifecycleStates: 0,
    timeseriesForecasts: 0,
  };

  try {
    counts.cveForecasts = await refreshCveForecasts();
  } catch (e) {
    errors.push(`cve_forecasts: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    counts.actorForecasts = await refreshActorForecasts();
  } catch (e) {
    errors.push(`actor_forecasts: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    counts.lifecycleStates = await refreshLifecycleStates();
  } catch (e) {
    errors.push(`lifecycle_states: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    counts.timeseriesForecasts = await refreshTimeseriesForecasts();
  } catch (e) {
    errors.push(`timeseries: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json<RouteResponse>({
    ok: errors.length === 0,
    counts,
    ms: Date.now() - start,
    errors,
  });
}

// ─── Per-model passes ───────────────────────────────────────────────────────

async function refreshCveForecasts(): Promise<number> {
  const model = await loadLogisticModel();
  // published_at is TEXT in the seed schema — cast to timestamptz for the
  // date filter. Most rows match 'YYYY-MM-DDTHH:MM:SS' so the cast is
  // unambiguous; malformed rows are silently excluded.
  const { rows } = await query<{
    cve_id: string;
    cvss_v3_score: number | null;
    epss_percentile: number | null;
    published_at: string;
  }>(
    `SELECT cve_id, cvss_v3_score, epss_percentile, published_at
       FROM aegis_cves
       WHERE COALESCE(is_kev, FALSE) = FALSE
         AND cvss_v3_score IS NOT NULL
         AND published_at::timestamptz >= NOW() - INTERVAL '365 days'
       ORDER BY cvss_v3_score DESC NULLS LAST, epss_percentile DESC NULLS LAST
       LIMIT $1`,
    [TOP_CVE_LIMIT],
  );

  let touched = 0;
  for (const row of rows) {
    const daysSincePublish = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(row.published_at)) / (1000 * 60 * 60 * 24)),
    );
    const features: ExploitFeatures = {
      cvssV3: Number(row.cvss_v3_score ?? 0),
      epssPercentile: Number(row.epss_percentile ?? 0.5),
      daysSincePublish,
      affectedProductPopularity: 0,
      vendorPatchLagDays: null,
    };
    const f = forecastExploit(features, model);
    const result = await query(
      `INSERT INTO aegis_cve_forecasts
         (cve_id, forecast_date, model_version,
          p_exploited_30d, p_exploited_60d, p_exploited_90d, ci_low, ci_high, features_json)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (cve_id, forecast_date, model_version) DO UPDATE
         SET p_exploited_30d = EXCLUDED.p_exploited_30d,
             p_exploited_60d = EXCLUDED.p_exploited_60d,
             p_exploited_90d = EXCLUDED.p_exploited_90d,
             ci_low = EXCLUDED.ci_low,
             ci_high = EXCLUDED.ci_high,
             features_json = EXCLUDED.features_json,
             generated_at = NOW()`,
      [
        row.cve_id,
        model.version,
        f.pExploited30d,
        f.pExploited60d,
        f.pExploited90d,
        f.ciLow,
        f.ciHigh,
        JSON.stringify(features),
      ],
    );
    if (result.rowCount && result.rowCount > 0) touched++;
  }
  return touched;
}

async function refreshActorForecasts(): Promise<number> {
  const recentCutoffSec = 90 * 24 * 60 * 60;
  const { rows: actors } = await query<{ actor_id: string }>(
    `SELECT DISTINCT actor_id FROM aegis_threat_actor_targets WHERE industry IS NOT NULL`,
  );
  let touched = 0;
  for (const actor of actors) {
    const { rows: targetRows } = await query<{ category: string; is_recent: boolean }>(
      `SELECT industry AS category,
              CASE WHEN created_at IS NULL THEN FALSE
                ELSE EXTRACT(EPOCH FROM (NOW() - created_at::timestamptz)) <= $2
              END AS is_recent
         FROM aegis_threat_actor_targets
         WHERE actor_id = $1 AND industry IS NOT NULL`,
      [actor.actor_id, recentCutoffSec],
    );
    const { rows: countryRows } = await query<{ category: string; is_recent: boolean }>(
      // Schema gotcha: targets table uses `geography` (not `country`)
      `SELECT geography AS category,
              CASE WHEN created_at IS NULL THEN FALSE
                ELSE EXTRACT(EPOCH FROM (NOW() - created_at::timestamptz)) <= $2
              END AS is_recent
         FROM aegis_threat_actor_targets
         WHERE actor_id = $1 AND geography IS NOT NULL`,
      [actor.actor_id, recentCutoffSec],
    );

    const sectorObs = aggregateObservations(
      targetRows.map((r) => ({ category: r.category, isRecent: r.is_recent })),
    );
    const countryObs = aggregateObservations(
      countryRows.map((r) => ({ category: r.category, isRecent: r.is_recent })),
    );
    if (sectorObs.length === 0 && countryObs.length === 0) continue;

    const sectorForecast = sectorObs.length > 0 ? forecastFromObservations(sectorObs) : null;
    const countryForecast = countryObs.length > 0 ? forecastFromObservations(countryObs) : null;
    const version =
      sectorForecast?.modelVersion ?? countryForecast?.modelVersion ?? 'actor-target-bayesian-v0_1';

    const result = await query(
      `INSERT INTO aegis_actor_target_forecasts
         (actor_id, forecast_date, model_version,
          top_sectors_json, top_countries_json, posterior_alpha_json)
       VALUES ($1, CURRENT_DATE, $2, $3::jsonb, $4::jsonb, $5::jsonb)
       ON CONFLICT (actor_id, forecast_date, model_version) DO UPDATE
         SET top_sectors_json = EXCLUDED.top_sectors_json,
             top_countries_json = EXCLUDED.top_countries_json,
             posterior_alpha_json = EXCLUDED.posterior_alpha_json,
             generated_at = NOW()`,
      [
        actor.actor_id,
        version,
        JSON.stringify(sectorForecast?.topCategories ?? []),
        JSON.stringify(countryForecast?.topCategories ?? []),
        JSON.stringify({
          sectors: sectorForecast?.posteriorAlpha ?? {},
          countries: countryForecast?.posteriorAlpha ?? {},
        }),
      ],
    );
    if (result.rowCount && result.rowCount > 0) touched++;
  }
  return touched;
}

async function refreshLifecycleStates(): Promise<number> {
  const hmmModel = await loadHmmModel();
  const knownEmissions = new Set<string>(EMISSIONS);
  const { rows: cves } = await query<{ cve_id: string }>(
    `SELECT DISTINCT cve_id FROM aegis_cve_severity_history WHERE event_type IS NOT NULL
       LIMIT 500`, // safety bound
  );
  let touched = 0;
  for (const row of cves) {
    const { rows: histRows } = await query<{ event_type: string | null }>(
      `SELECT event_type FROM aegis_cve_severity_history
         WHERE cve_id = $1 AND event_type IS NOT NULL ORDER BY observed_at ASC`,
      [row.cve_id],
    );
    const obs = histRows
      .map((r) => r.event_type as Emission)
      .filter((e): e is Emission => knownEmissions.has(e));
    if (obs.length === 0) continue;

    const result = inferCveState(obs, hmmModel);
    if (!result) continue;

    const r = await query(
      `INSERT INTO aegis_cve_lifecycle_states
         (cve_id, observation_date, model_version,
          state_distribution_json, viterbi_path_json, expected_days_to_kev)
       VALUES ($1, CURRENT_DATE, $2, $3::jsonb, $4::jsonb, $5)
       ON CONFLICT (cve_id, observation_date, model_version) DO UPDATE
         SET state_distribution_json = EXCLUDED.state_distribution_json,
             viterbi_path_json = EXCLUDED.viterbi_path_json,
             expected_days_to_kev = EXCLUDED.expected_days_to_kev,
             generated_at = NOW()`,
      [
        row.cve_id,
        result.modelVersion,
        JSON.stringify(result.stateDistribution),
        JSON.stringify(result.viterbiPath),
        result.expectedDaysToState.Mass_Exploitation,
      ],
    );
    if (r.rowCount && r.rowCount > 0) touched++;
  }
  return touched;
}

async function refreshTimeseriesForecasts(): Promise<number> {
  let touched = 0;
  for (const metric of METRICS as readonly Metric[]) {
    const { rows } = await query<{ date: string; value: number }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, ${metric} AS value
         FROM aegis_daily_metrics
         WHERE date >= CURRENT_DATE - INTERVAL '365 days'
         ORDER BY date ASC`,
    );
    const history: DailyValue[] = rows.map((r) => ({ date: r.date, value: Number(r.value) || 0 }));
    if (history.length < 5) continue;

    for (const horizon of HORIZONS) {
      const f = forecastMetric(metric, history, horizon);
      if (!f) continue;
      const lastPoint = f.forecast[f.forecast.length - 1];
      if (!lastPoint) continue;
      const r = await query(
        `INSERT INTO aegis_timeseries_forecasts
           (metric_name, forecast_date, horizon_days, p_low, p_mid, p_high, trend, model_version)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (metric_name, forecast_date, horizon_days, model_version) DO UPDATE
           SET p_low = EXCLUDED.p_low,
               p_mid = EXCLUDED.p_mid,
               p_high = EXCLUDED.p_high,
               trend = EXCLUDED.trend,
               generated_at = NOW()`,
        [metric, horizon, lastPoint.pLow, lastPoint.pMid, lastPoint.pHigh, f.trend, f.modelVersion],
      );
      if (r.rowCount && r.rowCount > 0) touched++;
    }
  }
  return touched;
}

export const POST = withRoutePolicy('/api/aegis/forecast-daily', routePOSTImplementation);
export const GET = withRoutePolicy('/api/aegis/forecast-daily', routeGETImplementation);

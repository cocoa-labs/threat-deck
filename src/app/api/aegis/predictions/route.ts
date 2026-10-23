import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.D — PredictionsPanel data endpoint.
 *
 * GET /api/aegis/predictions?model={logistic|bayesian|hmm|timeseries|causal}&limit=10
 *
 * Returns top-N items per model for the panel's pill-selector views.
 * Each row is a thin summary — clicking it opens the AgentDrawer with
 * full context, so we don't need to inline every detail here.
 *
 * Model-specific behaviour:
 *   logistic    → top-N CVEs by p_exploited_30d (from aegis_v_top_likely_exploits
 *                 if cron has populated, else live compute over top-N CVEs by CVSS)
 *   bayesian    → top-N (actor, sector) pairs by posterior mean
 *   hmm         → top-N CVEs by P(Mass_Exploitation) + P(Weaponized)
 *   timeseries  → 5 mini sparkline summaries (one per metric)
 *   causal      → top-N counterfactual deltas (do(patch=fast) → BreachDisclosure)
 *
 * Returns 400 for an unrecognized model name. All other failures fall back
 * to `{ ok: true, model, items: [] }` so the panel renders empty gracefully.
 */

import { NextResponse } from 'next/server';
import {
  aggregateObservations,
  type CategoryObservation,
  forecastFromObservations,
} from '@/lib/aegis/forecasting/actor-target-bayesian';
import {
  buildInitialModel as buildCausalModel,
  doIntervene,
  type Variable,
} from '@/lib/aegis/forecasting/causal-dag';
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
} from '@/lib/aegis/forecasting/timeseries-kalman';
import { query } from '@/lib/db/client';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

type ModelName = 'logistic' | 'bayesian' | 'hmm' | 'timeseries' | 'causal';
const VALID_MODELS: readonly ModelName[] = ['logistic', 'bayesian', 'hmm', 'timeseries', 'causal'];

interface PanelItem {
  /** Stable identifier — CVE id, actor id, metric name, scenario hash. */
  id: string;
  /** Human-readable label rendered in the panel row. */
  label: string;
  /** Primary metric — interpretation depends on model. */
  primaryValue: number;
  /** Optional secondary metric (e.g., CI half-width). */
  secondaryValue?: number;
  /** Tertiary string field used for chips/badges (severity / trend / actor name). */
  badge?: string;
  /** Click-through URL to the canonical AEGIS HTML view. */
  sourceUrl?: string;
}

interface RouteResponse {
  ok: boolean;
  model: ModelName | null;
  items: PanelItem[];
  modelVersion: string | null;
  error?: string;
}

async function handleGet(request: Request): Promise<NextResponse<RouteResponse>> {
  const { searchParams } = new URL(request.url);
  const modelParam = (searchParams.get('model') ?? 'logistic') as ModelName;
  const limit = Math.min(50, Math.max(1, Number.parseInt(searchParams.get('limit') ?? '10', 10)));

  if (!VALID_MODELS.includes(modelParam)) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        model: null,
        items: [],
        modelVersion: null,
        error: `invalid_model: must be one of ${VALID_MODELS.join('|')}`,
      },
      { status: 400 },
    );
  }

  try {
    switch (modelParam) {
      case 'logistic':
        return NextResponse.json(await getLogisticItems(limit));
      case 'bayesian':
        return NextResponse.json(await getBayesianItems(limit));
      case 'hmm':
        return NextResponse.json(await getHmmItems(limit));
      case 'timeseries':
        return NextResponse.json(await getTimeseriesItems());
      case 'causal':
        return NextResponse.json(await getCausalItems(limit));
    }
  } catch (err) {
    return NextResponse.json<RouteResponse>({
      ok: true, // soft-fail so panel renders an empty state
      model: modelParam,
      items: [],
      modelVersion: null,
      error: err instanceof Error ? err.message : 'panel_data_failed',
    });
  }
}

// ─── Per-model gatherers ─────────────────────────────────────────────────────

interface CveSourceRow {
  cve_id: string;
  cvss_v3_score: number | null;
  epss_percentile: number | null;
  published_at: string;
  severity: string | null;
  is_kev: boolean | null;
}

/**
 * Logistic: top-N most-likely-soon-exploited CVEs not already in KEV.
 * Uses CVSS-DESC + EPSS-DESC pre-filter to pick the 200 highest-leverage
 * non-KEV CVEs, computes their 30-day forecast live, returns top N.
 */
async function getLogisticItems(limit: number): Promise<RouteResponse> {
  const model = await loadLogisticModel();
  const { rows } = await query<CveSourceRow>(
    `SELECT cve_id, cvss_v3_score, epss_percentile, published_at, severity, is_kev
       FROM aegis_cves
       WHERE COALESCE(is_kev, FALSE) = FALSE
         AND cvss_v3_score IS NOT NULL
       ORDER BY cvss_v3_score DESC NULLS LAST, epss_percentile DESC NULLS LAST
       LIMIT 200`,
  );

  const scored: PanelItem[] = [];
  for (const row of rows) {
    const days = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(row.published_at)) / (1000 * 60 * 60 * 24)),
    );
    const features: ExploitFeatures = {
      cvssV3: Number(row.cvss_v3_score ?? 0),
      epssPercentile: Number(row.epss_percentile ?? 0.5),
      daysSincePublish: days,
      affectedProductPopularity: 0,
      vendorPatchLagDays: null,
    };
    const r = forecastExploit(features, model);
    scored.push({
      id: row.cve_id,
      label: row.cve_id,
      primaryValue: r.pExploited30d,
      secondaryValue: r.ciHigh - r.ciLow,
      badge: row.severity ?? undefined,
      sourceUrl: `/api/aegis/cves/view?id=${encodeURIComponent(row.cve_id)}`,
    });
  }
  scored.sort((a, b) => b.primaryValue - a.primaryValue);

  return {
    ok: true,
    model: 'logistic',
    items: scored.slice(0, limit),
    modelVersion: model.version,
  };
}

/**
 * Bayesian: top-N actors (by composite_score), each with their top sector.
 */
async function getBayesianItems(limit: number): Promise<RouteResponse> {
  const { rows: actors } = await query<{
    actor_id: string;
    display_name: string;
    composite_score: number | null;
  }>(
    `SELECT a.actor_id, a.display_name, s.composite_score
       FROM aegis_threat_actors a
       LEFT JOIN aegis_threat_actor_scores s ON s.actor_id = a.actor_id
       ORDER BY s.composite_score DESC NULLS LAST
       LIMIT $1`,
    [limit * 3], // over-fetch — some actors have no target data
  );

  const items: PanelItem[] = [];
  let modelVersion = 'actor-target-bayesian-v0_1';

  for (const actor of actors) {
    if (items.length >= limit) break;
    const { rows: targets } = await query<{ category: string; is_recent: boolean }>(
      `SELECT industry AS category,
              CASE WHEN created_at IS NULL THEN FALSE
                ELSE EXTRACT(EPOCH FROM (NOW() - created_at::timestamptz)) <= 7776000
              END AS is_recent
         FROM aegis_threat_actor_targets
         WHERE actor_id = $1 AND industry IS NOT NULL`,
      [actor.actor_id],
    );
    if (targets.length === 0) continue;

    const obs: CategoryObservation[] = aggregateObservations(
      targets.map((t) => ({ category: t.category, isRecent: t.is_recent })),
    );
    const forecast = forecastFromObservations(obs, { topK: 1 });
    const top = forecast.topCategories[0];
    if (!top) continue;
    modelVersion = forecast.modelVersion;

    items.push({
      id: actor.actor_id,
      label: `${actor.display_name} → ${top.category}`,
      primaryValue: top.pMean,
      secondaryValue: top.pHigh - top.pLow,
      badge: actor.display_name,
      sourceUrl: `/api/aegis/threat-actors/view?id=${encodeURIComponent(actor.actor_id)}`,
    });
  }

  return { ok: true, model: 'bayesian', items, modelVersion };
}

/**
 * HMM: top-N CVEs by combined P(Weaponized) + P(Mass_Exploitation) — the
 * "active danger" states. Live-computed; the cron will pre-populate.
 */
async function getHmmItems(limit: number): Promise<RouteResponse> {
  const hmmModel = await loadHmmModel();
  // Pre-filter to CVEs with at least 1 severity-history event — others
  // give uniform-prior state distributions with no signal.
  const { rows } = await query<{ cve_id: string; n: string; severity: string | null }>(
    `SELECT c.cve_id,
            COUNT(h.id)::text AS n,
            c.severity
       FROM aegis_cves c
       JOIN aegis_cve_severity_history h ON h.cve_id = c.cve_id
       WHERE COALESCE(c.is_kev, FALSE) = FALSE
       GROUP BY c.cve_id, c.severity
       HAVING COUNT(h.id) >= 1
       ORDER BY COUNT(h.id) DESC
       LIMIT 200`,
  );

  const items: PanelItem[] = [];
  const knownEmissions = new Set<string>(EMISSIONS);

  for (const row of rows) {
    if (items.length >= limit * 3) break; // over-process, sort below
    const { rows: histRows } = await query<{ event_type: string | null }>(
      `SELECT event_type FROM aegis_cve_severity_history
         WHERE cve_id = $1 AND event_type IS NOT NULL
         ORDER BY observed_at ASC`,
      [row.cve_id],
    );
    const obs = histRows
      .map((h) => h.event_type as Emission)
      .filter((e): e is Emission => knownEmissions.has(e));
    if (obs.length === 0) continue;

    const result = inferCveState(obs, hmmModel);
    if (!result) continue;

    const weaponized = result.stateDistribution[2] ?? 0;
    const mass = result.stateDistribution[3] ?? 0;
    items.push({
      id: row.cve_id,
      label: row.cve_id,
      primaryValue: weaponized + mass,
      secondaryValue: result.expectedDaysToState.Mass_Exploitation ?? undefined,
      badge: row.severity ?? undefined,
      sourceUrl: `/api/aegis/cves/view?id=${encodeURIComponent(row.cve_id)}`,
    });
  }

  items.sort((a, b) => b.primaryValue - a.primaryValue);
  return {
    ok: true,
    model: 'hmm',
    items: items.slice(0, limit),
    modelVersion: hmmModel.version,
  };
}

/**
 * Timeseries: 5 sparkline-summary rows, one per metric. primaryValue is
 * the 30-day median projection, secondaryValue is the trend numeric
 * (positive=rising). badge is the trend label string.
 */
async function getTimeseriesItems(): Promise<RouteResponse> {
  const items: PanelItem[] = [];
  for (const metric of METRICS) {
    const { rows } = await query<{ date: string; value: number }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, ${metric} AS value
         FROM aegis_daily_metrics
         WHERE date >= CURRENT_DATE - INTERVAL '90 days'
         ORDER BY date ASC`,
    );
    const history: DailyValue[] = rows.map((r) => ({
      date: r.date,
      value: Number(r.value) || 0,
    }));
    const r = forecastMetric(metric, history, 30);
    if (!r) continue;
    items.push({
      id: metric,
      label: metric.replace('_', ' '),
      primaryValue: r.forecast[r.forecast.length - 1]?.pMid ?? 0,
      secondaryValue: r.trend === 'rising' ? 1 : r.trend === 'falling' ? -1 : 0,
      badge: r.trend,
    });
  }
  return { ok: true, model: 'timeseries', items, modelVersion: 'timeseries-kalman-v0_1' };
}

/**
 * Causal: top-N counterfactual scenarios, ranked by absolute delta in
 * BreachDisclosure probability. For v0.1 we precompute a small fixed set
 * of scenarios — one per actor + patch-lag combination.
 */
async function getCausalItems(limit: number): Promise<RouteResponse> {
  const model = buildCausalModel();
  const actors = model.domains.Actor;
  const interventions: Array<{ from: 'severe' | 'slow'; to: 'fast' | 'medium' }> = [
    { from: 'severe', to: 'fast' },
    { from: 'slow', to: 'fast' },
    { from: 'severe', to: 'medium' },
  ];

  const items: PanelItem[] = [];
  for (const actor of actors) {
    for (const { from, to } of interventions) {
      const baseline = doIntervene(
        {
          evidence: { Actor: actor as Variable extends 'Actor' ? string : never },
          intervention: { variable: 'VendorPatchLag', value: from },
          target: 'BreachDisclosure',
        },
        model,
      );
      const intervention = doIntervene(
        {
          evidence: { Actor: actor },
          intervention: { variable: 'VendorPatchLag', value: to },
          target: 'BreachDisclosure',
        },
        model,
      );
      if (!baseline || !intervention) continue;
      const baseDisclosed =
        baseline.intervention.distribution.find((d) => d.value === 'Disclosed')?.probability ?? 0;
      const interDisclosed =
        intervention.intervention.distribution.find((d) => d.value === 'Disclosed')?.probability ??
        0;
      const delta = baseDisclosed - interDisclosed; // positive = good (risk reduced)
      items.push({
        id: `${actor}|${from}->${to}`,
        label: `${actor}: patch ${from}→${to}`,
        primaryValue: delta,
        secondaryValue: baseDisclosed,
        badge: actor,
      });
    }
  }

  items.sort((a, b) => Math.abs(b.primaryValue) - Math.abs(a.primaryValue));
  return {
    ok: true,
    model: 'causal',
    items: items.slice(0, limit),
    modelVersion: model.version,
  };
}

// Phase 13 Tier 3 — Per-IP rate-limit. Panel auto-polls (every 5 min by
// default) + dashboard switching across models can fan out multiple
// requests per user-action; 120/min is comfortable for an analyst
// flipping pills, well below DoS threshold.
const routeGETImplementation = withRateLimit(handleGet, {
  key: (req: Request) => `predictions-panel:${getClientIp(req)}`,
  limit: 120,
  windowMs: 60_000,
});

export const GET = withRoutePolicy('/api/aegis/predictions', routeGETImplementation);

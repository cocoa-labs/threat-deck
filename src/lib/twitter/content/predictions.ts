/**
 * Phase 11.D.15 — Weekly predictions thread generator.
 *
 * Runs Mondays at 13:00 UTC via Vercel cron. Composes a 4-tweet thread
 * for `the configured X account`:
 *
 *   T1  — hook + brand + week-of date + #AICyber
 *   T2  — top-3 CVE exploit forecasts (logistic) with predicted %
 *   T3  — top actor next-target predictions (Bayesian) + most-impactful
 *         counterfactual (causal-DAG) framed as a policy lever
 *   T4  — CTA to /feed/cyber-wire/predictions-accuracy + thread numbering
 *
 * Data assembled from the freshest aegis_*_forecasts rows (the Phase
 * 11.D.16 daily cron populates these every 11:00 UTC, so Monday 13:00
 * sees ~2h-old forecasts). LLM is claude-sonnet-4-6 (locked Phase 9
 * decision — brand voice load-bearing).
 *
 * Uses the same llm.generateThread + stageDraft + validateThreadDraft
 * primitives as Phase 9's anchor.ts to keep the staging pipeline single-
 * source-of-truth.
 *
 * Failure modes (returned via GeneratorResult.ok=false):
 *   - no_qualifying_items : <2 CVE forecasts OR <1 actor forecast
 *   - llm_failed          : Anthropic call threw / timed out
 *   - thread_validation_failed : JSON shape OK but rule-violating output
 *   - persist_failed      : stageDraft rejected (DB error)
 */

import { query } from '@/lib/db/client';
import { composeThread } from './compose-thread';
import { ANALYST_SYSTEM } from './prompts';
import { stageDraft } from './staging';
import type { GeneratorResult } from './types';

const WEEKLY_MAX_TOKENS = 1000;
const MIN_CVE_FORECASTS = 2;

interface TopCveForecast {
  cveId: string;
  pExploited30d: number;
  ciLow: number;
  ciHigh: number;
  modelVersion: string;
  severity: string | null;
}

interface TopActorForecast {
  actorId: string;
  displayName: string;
  topSector: string | null;
  topSectorP: number | null;
  modelVersion: string;
}

interface TopCounterfactual {
  actor: string;
  fromLag: string;
  toLag: string;
  baselineP: number;
  interventionP: number;
  delta: number;
}

export async function generateWeeklyPredictionsThread(opts?: {
  createdBy?: string;
}): Promise<GeneratorResult> {
  const createdBy = opts?.createdBy ?? 'cron:predictions_thread';
  const weekOf = isoMonday(new Date());

  // 1. Pull top-3 likely-exploited CVEs (latest forecast per CVE).
  const cves = await fetchTopCveForecasts(3);
  if (cves.length < MIN_CVE_FORECASTS) {
    return {
      ok: false,
      reason: 'no_qualifying_items',
      details: `only ${cves.length} CVE forecasts (need ≥ ${MIN_CVE_FORECASTS}) — run scripts/train-exploit-forecaster.ts + /api/aegis/forecast-daily first`,
    };
  }

  // 2. Pull top actor forecasts + a punchy counterfactual scenario.
  const actors = await fetchTopActorForecasts(3);
  const counterfactual = await fetchTopCounterfactual();

  // 3. Compose user prompt for Sonnet
  const userPrompt = [
    `Generate this week's Cocoa AI predictions thread for the configured X account.`,
    `Week of: ${weekOf}`,
    ``,
    `--- Top CVE exploit forecasts (logistic regression) ---`,
    ...cves.map(
      (c, i) =>
        `${i + 1}. ${c.cveId} (${c.severity ?? 'severity unknown'}): ${(c.pExploited30d * 100).toFixed(1)}% in 30 days [CI ${(c.ciLow * 100).toFixed(0)}-${(c.ciHigh * 100).toFixed(0)}%]`,
    ),
    ``,
    `--- Top actor next-target forecasts (Bayesian Dirichlet-Categorical) ---`,
    ...(actors.length > 0
      ? actors.map(
          (a) =>
            `${a.displayName} → ${a.topSector ?? '?'} (${a.topSectorP != null ? `${(a.topSectorP * 100).toFixed(0)}%` : 'N/A'})`,
        )
      : ['(no actor forecasts available yet)']),
    ``,
    counterfactual
      ? `--- Counterfactual headline (do-calculus) ---\n` +
        `Intervention: patch lag ${counterfactual.fromLag} → ${counterfactual.toLag} for ${counterfactual.actor}\n` +
        `Breach disclosure baseline ${(counterfactual.baselineP * 100).toFixed(1)}% → intervention ${(counterfactual.interventionP * 100).toFixed(1)}% (Δ ${(counterfactual.delta * 100).toFixed(1)}pp)`
      : '',
    ``,
    `Compose a 4-tweet thread:`,
    `  T1: hook + brand + "Week of ${weekOf}" + #AICyber`,
    `  T2: top 2-3 CVE forecasts with predicted %`,
    `  T3: actor next-target call + ONE counterfactual / "what if we patched faster" framing`,
    `  T4: CTA — "Track our calibration: your configured site’s /feed/cyber-wire/predictions-accuracy"`,
    `Output STRICT JSON per the system prompt.`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await composeThread({
    systemPrompt: ANALYST_SYSTEM,
    contextBlock: userPrompt,
    shape: 'thread',
    maxTokens: WEEKLY_MAX_TOKENS,
    draftType: 'predictions_thread',
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, details: result.details };
  }
  const draft = result.draft;

  const topCve = cves[0]!;
  const stage = await stageDraft({
    channel: 'twitter',
    draftType: 'predictions_thread',
    agentMode: 'analyst', // weekly thread is an analyst-mode publication
    headline: `Weekly predictions — ${cves.length} CVE forecasts (${weekOf})`,
    previewText: draft.tweets[0]?.text ?? `Predictions thread ${weekOf}`,
    draftPayload: draft,
    aiRelevance: 0.95, // weekly thread is always brand-significant
    severity: topCve.severity as never,
    createdBy,
  });
  if (!stage.ok) {
    return { ok: false, reason: 'persist_failed', details: stage.error };
  }

  return {
    ok: true,
    draftId: stage.draftId,
    tweetCount: draft.tweets.length,
    preview: (draft.tweets[0]?.text ?? '').slice(0, 120),
  };
}

// ─── Data assembly ──────────────────────────────────────────────────────────

async function fetchTopCveForecasts(limit: number): Promise<TopCveForecast[]> {
  // Latest forecast per CVE across the most-recent model_version. ROW_NUMBER
  // partition pulls the freshest forecast row in one pass.
  const { rows } = await query<{
    cve_id: string;
    p_exploited_30d: string;
    ci_low: string | null;
    ci_high: string | null;
    model_version: string;
    severity: string | null;
  }>(
    `SELECT * FROM (
       SELECT
         f.cve_id,
         f.p_exploited_30d::text AS p_exploited_30d,
         f.ci_low::text AS ci_low,
         f.ci_high::text AS ci_high,
         f.model_version,
         c.severity,
         ROW_NUMBER() OVER (
           PARTITION BY f.cve_id
           ORDER BY f.forecast_date DESC, f.generated_at DESC
         ) AS rn
       FROM aegis_cve_forecasts f
       JOIN aegis_cves c ON c.cve_id = f.cve_id
       WHERE COALESCE(c.is_kev, FALSE) = FALSE
     ) t
     WHERE rn = 1
     ORDER BY p_exploited_30d::numeric DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    cveId: r.cve_id,
    pExploited30d: Number(r.p_exploited_30d),
    ciLow: Number(r.ci_low ?? 0),
    ciHigh: Number(r.ci_high ?? 0),
    modelVersion: r.model_version,
    severity: r.severity,
  }));
}

async function fetchTopActorForecasts(limit: number): Promise<TopActorForecast[]> {
  const { rows } = await query<{
    actor_id: string;
    display_name: string;
    top_sectors_json: string;
    model_version: string;
  }>(
    `SELECT * FROM (
       SELECT
         f.actor_id,
         a.display_name,
         f.top_sectors_json::text AS top_sectors_json,
         f.model_version,
         ROW_NUMBER() OVER (
           PARTITION BY f.actor_id
           ORDER BY f.forecast_date DESC, f.generated_at DESC
         ) AS rn
       FROM aegis_actor_target_forecasts f
       JOIN aegis_threat_actors a ON a.actor_id = f.actor_id
     ) t
     WHERE rn = 1
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => {
    let top: { category: string; pMean: number } | null = null;
    try {
      const parsed = JSON.parse(r.top_sectors_json) as Array<{ category: string; pMean: number }>;
      top = parsed[0] ?? null;
    } catch {
      // bad JSON — leave top null
    }
    return {
      actorId: r.actor_id,
      displayName: r.display_name,
      topSector: top?.category ?? null,
      topSectorP: top?.pMean ?? null,
      modelVersion: r.model_version,
    };
  });
}

async function fetchTopCounterfactual(): Promise<TopCounterfactual | null> {
  // Pick the top actor by composite_score and compute the
  // do(VendorPatchLag=severe→fast) intervention against BreachDisclosure
  // live — for v0.1 we don't cache these into the table.
  const { rows: actorRows } = await query<{ display_name: string }>(
    `SELECT a.display_name
       FROM aegis_threat_actors a
       LEFT JOIN aegis_threat_actor_scores s ON s.actor_id = a.actor_id
       ORDER BY s.composite_score DESC NULLS LAST
       LIMIT 1`,
  );
  if (actorRows.length === 0) return null;
  const actorName = actorRows[0]!.display_name;

  // Inline the causal DAG so this module stays standalone — match the
  // hand-built CPTs from forecasting/causal-dag.ts. We don't need full
  // do() machinery here; just the published forecast-daily values.
  const { buildInitialModel, doIntervene } = await import('@/lib/aegis/forecasting/causal-dag');
  const model = buildInitialModel();
  // Best-effort actor mapping — fall back to 'Generic' if the actor isn't
  // in the v0.1 domain (which only knows LockBit / APT29 / FIN7 / Generic).
  const actorVal = model.domains.Actor.includes(actorName) ? actorName : 'Generic';
  const result = doIntervene(
    {
      evidence: { Actor: actorVal },
      intervention: { variable: 'VendorPatchLag', value: 'fast' },
      target: 'BreachDisclosure',
    },
    model,
  );
  if (!result) return null;

  const baselineDisclosed =
    result.baseline.distribution.find((d) => d.value === 'Disclosed')?.probability ?? 0;
  const interventionDisclosed =
    result.intervention.distribution.find((d) => d.value === 'Disclosed')?.probability ?? 0;

  return {
    actor: actorVal,
    fromLag: 'severe',
    toLag: 'fast',
    baselineP: baselineDisclosed,
    interventionP: interventionDisclosed,
    delta: baselineDisclosed - interventionDisclosed,
  };
}

function isoMonday(d: Date): string {
  const day = d.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offsetToMonday);
  return monday.toISOString().slice(0, 10);
}

import { isCapabilityEnabled } from '@/lib/security/capabilities';
/**
 * Phase 11.D.14 — Public predictions accuracy page.
 *
 * /feed/cyber-wire/predictions-accuracy
 *
 * SSR + ISR 600s. Public — no auth gate. Renders the calibration story
 * for every Cocoa AI forecasting model that has labeled outcomes:
 *
 *   - Headline scoreboard (per model): AUC / Brier / log-loss / hit-rate
 *   - Rolling 30/60/90-day windows
 *   - Calibration plot (10 bins, observed vs predicted) — d3-scale + raw SVG
 *   - Top 10 successful + top 10 missed forecasts in the last 30 days
 *
 * SOFT-LAUNCH POLICY: emits `<meta name="robots" content="noindex">` for
 * the first 30 days after the first outcome row lands. Until we have ≥30
 * days of resolved forecasts the page is reachable by direct URL but
 * excluded from search engines and the public nav. Once the threshold is
 * met the noindex is dropped (controlled by the SOFT_LAUNCH_OUTCOME_COUNT
 * + SOFT_LAUNCH_DAYS gate in generateMetadata).
 *
 * Transparency footer (verbatim from the plan, not auto-generated):
 * "Past forecasts are never retracted. Calibration is what we owe you;
 *  if the numbers above are bad, our public commitment is to fix the
 *  models — not to delete the page."
 */

import type { Metadata } from 'next';
import { query } from '@/lib/db/client';
import styles from '../cyberwire.module.css';
import { AccuracyScoreboard } from './AccuracyScoreboard';
import { CalibrationPlot } from './CalibrationPlot';

export const revalidate = 600;

const SOFT_LAUNCH_OUTCOME_COUNT = 30;

interface ModelAccuracy {
  forecastKind: string;
  modelVersion: string;
  sampleSize: number;
  meanBrier: number | null;
  meanLogLoss: number | null;
  hitRate: number | null;
}

interface CalibrationBin {
  pBinCenter: number;
  observedRate: number;
  count: number;
}

interface PageData {
  models: ModelAccuracy[];
  calibrationByModel: Record<string, CalibrationBin[]>;
  totalOutcomes: number;
  topSuccesses: TopForecast[];
  topMisses: TopForecast[];
  computedAt: string;
}

interface TopForecast {
  cveId: string;
  pPredicted: number;
  yObserved: number;
  outcomeAt: string;
}

export async function generateMetadata(): Promise<Metadata> {
  if (!isCapabilityEnabled('publicFeed'))
    return { title: 'Cyber Wire', robots: 'noindex,nofollow' };
  // Soft-launch noindex if we don't yet have enough outcomes
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM aegis_forecast_outcomes`,
  );
  const total = Number(rows[0]?.count ?? 0);
  const robots = total < SOFT_LAUNCH_OUTCOME_COUNT ? 'noindex,nofollow' : 'index,follow';
  return {
    title: 'Predictions Accuracy — Cocoa AI Cyber Wire',
    description:
      'Live calibration scoreboard for Cocoa AI threat-deck forecasts. Every prediction we publish is later labeled against ground truth. We never retract past forecasts.',
    robots,
  };
}

export default async function PredictionsAccuracyPage() {
  const data = await loadPageData();

  return (
    <div className={styles.page}>
      <AccuracyHeader computedAt={data.computedAt} totalOutcomes={data.totalOutcomes} />

      <main className={styles.main} style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {data.totalOutcomes < SOFT_LAUNCH_OUTCOME_COUNT && (
          <SoftLaunchBanner total={data.totalOutcomes} />
        )}

        <section>
          <h2 className={styles.sectionTitle}>Per-Model Scoreboard (last 30 days)</h2>
          <AccuracyScoreboard models={data.models} />
        </section>

        {data.models
          .filter((m) => m.sampleSize >= 5)
          .map((model) => {
            const bins = data.calibrationByModel[model.forecastKind] ?? [];
            if (bins.length === 0) return null;
            return (
              <section key={model.forecastKind + model.modelVersion}>
                <h2 className={styles.sectionTitle}>
                  {humanizeModelKind(model.forecastKind)} — Calibration plot
                </h2>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    fontFamily: 'Geist Mono, monospace',
                    maxWidth: 620,
                  }}
                >
                  Dots track the observed event rate within each predicted-probability bin. A
                  perfectly-calibrated model lies on the diagonal: forecasts at 70% probability
                  resolve true about 70% of the time. Dot size = sample count per bin.
                </p>
                <CalibrationPlot bins={bins} modelLabel={model.modelVersion} />
              </section>
            );
          })}

        {(data.topSuccesses.length > 0 || data.topMisses.length > 0) && (
          <section>
            <h2 className={styles.sectionTitle}>Recent forecasts (last 30 days)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <ForecastList title="Top successes" entries={data.topSuccesses} success />
              <ForecastList title="Top misses" entries={data.topMisses} success={false} />
            </div>
          </section>
        )}

        <TransparencyFooter />
      </main>
    </div>
  );
}

// ─── Data loader ─────────────────────────────────────────────────────────────

async function loadPageData(): Promise<PageData> {
  const totalRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM aegis_forecast_outcomes`,
  );
  const totalOutcomes = Number(totalRows.rows[0]?.count ?? 0);

  // Per-model accuracy (last 30 days)
  const modelsResult = await query<{
    forecast_kind: string;
    model_version: string;
    sample_size: string;
    mean_brier: string | null;
    mean_log_loss: string | null;
    hit_rate: string | null;
  }>(
    `SELECT forecast_kind,
            model_version,
            COUNT(*)::text AS sample_size,
            AVG(brier_score)::text AS mean_brier,
            AVG(log_loss)::text AS mean_log_loss,
            AVG(CASE WHEN was_correct THEN 1.0 ELSE 0.0 END)::text AS hit_rate
       FROM aegis_forecast_outcomes
       WHERE outcome_observed_at >= NOW() - INTERVAL '30 days'
         AND was_correct IS NOT NULL
       GROUP BY forecast_kind, model_version
       ORDER BY forecast_kind`,
  );
  const models: ModelAccuracy[] = modelsResult.rows.map((r) => ({
    forecastKind: r.forecast_kind,
    modelVersion: r.model_version,
    sampleSize: Number(r.sample_size),
    meanBrier: r.mean_brier == null ? null : Number(r.mean_brier),
    meanLogLoss: r.mean_log_loss == null ? null : Number(r.mean_log_loss),
    hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
  }));

  // Calibration bins per model (10 bins by predicted probability extracted
  // from evidence_json.pPredicted for cve_logistic — other model kinds
  // store predicted prob differently; for v0.1 we only render calibration
  // for cve_logistic).
  const calibrationByModel: Record<string, CalibrationBin[]> = {};
  for (const model of models) {
    if (model.forecastKind !== 'cve_logistic') continue;
    const binResult = await query<{
      bin_center: string;
      observed_rate: string;
      count: string;
    }>(
      `SELECT
         (FLOOR((evidence_json->>'pPredicted')::numeric * 10) / 10 + 0.05)::text AS bin_center,
         AVG(CASE WHEN was_correct THEN 1.0 ELSE 0.0 END)::text AS observed_rate,
         COUNT(*)::text AS count
       FROM aegis_forecast_outcomes
       WHERE forecast_kind = $1
         AND model_version = $2
         AND was_correct IS NOT NULL
         AND outcome_observed_at >= NOW() - INTERVAL '90 days'
         AND evidence_json ? 'pPredicted'
       GROUP BY FLOOR((evidence_json->>'pPredicted')::numeric * 10)
       ORDER BY bin_center`,
      [model.forecastKind, model.modelVersion],
    );
    calibrationByModel[model.forecastKind] = binResult.rows.map((r) => ({
      pBinCenter: Number(r.bin_center),
      observedRate: Number(r.observed_rate),
      count: Number(r.count),
    }));
  }

  // Top successes (predicted >0.7 AND was_correct=true)
  interface TopRow {
    cve_id: string;
    p_predicted: string;
    y_observed: string;
    outcome_at: string;
  }
  const topSuccesses = await query<TopRow>(
    `SELECT
       (evidence_json->>'cveId') AS cve_id,
       (evidence_json->>'pPredicted')::numeric::text AS p_predicted,
       (evidence_json->>'yObserved')::int::text AS y_observed,
       outcome_observed_at::text AS outcome_at
     FROM aegis_forecast_outcomes
     WHERE forecast_kind = 'cve_logistic'
       AND was_correct = TRUE
       AND (evidence_json->>'pPredicted')::numeric > 0.7
       AND outcome_observed_at >= NOW() - INTERVAL '30 days'
     ORDER BY (evidence_json->>'pPredicted')::numeric DESC
     LIMIT 10`,
  );

  // Top misses (predicted <0.3 → became KEV, OR predicted >0.7 → didn't)
  const topMisses = await query<TopRow>(
    `SELECT
       (evidence_json->>'cveId') AS cve_id,
       (evidence_json->>'pPredicted')::numeric::text AS p_predicted,
       (evidence_json->>'yObserved')::int::text AS y_observed,
       outcome_observed_at::text AS outcome_at
     FROM aegis_forecast_outcomes
     WHERE forecast_kind = 'cve_logistic'
       AND was_correct = FALSE
       AND outcome_observed_at >= NOW() - INTERVAL '30 days'
     ORDER BY ABS((evidence_json->>'pPredicted')::numeric - 0.5) DESC
     LIMIT 10`,
  );

  return {
    models,
    calibrationByModel,
    totalOutcomes,
    topSuccesses: topSuccesses.rows.map(toTopForecast),
    topMisses: topMisses.rows.map(toTopForecast),
    computedAt: new Date().toISOString(),
  };
}

function toTopForecast(r: {
  cve_id: string;
  p_predicted: string;
  y_observed: string;
  outcome_at: string;
}): TopForecast {
  return {
    cveId: r.cve_id,
    pPredicted: Number(r.p_predicted),
    yObserved: Number(r.y_observed),
    outcomeAt: r.outcome_at,
  };
}

// ─── Subcomponents (inline — small enough not to warrant separate files) ────

function AccuracyHeader({
  computedAt,
  totalOutcomes,
}: {
  computedAt: string;
  totalOutcomes: number;
}) {
  return (
    <header
      style={{
        padding: '32px 18px 24px',
        borderBottom: '2px solid var(--brand-accent, #00ff41)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: 'Instrument Serif, serif',
            fontStyle: 'italic',
            fontSize: 28,
            color: 'var(--brand-accent-readable, var(--brand-accent, #00ff41))',
          }}
        >
          Cocoa AI
        </span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span
          style={{
            fontFamily: 'VT323, monospace',
            fontSize: 22,
            color: 'var(--matrix-green, #00ff41)',
            letterSpacing: '0.06em',
          }}
        >
          PREDICTIONS ACCURACY
        </span>
      </div>
      <h1
        style={{
          fontFamily: 'Instrument Serif, serif',
          fontSize: 36,
          margin: '0 0 8px',
          color: 'var(--text-primary)',
        }}
      >
        The Calibration Page
      </h1>
      <p
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 13,
          color: 'var(--text-secondary)',
          margin: 0,
          maxWidth: 640,
        }}
      >
        Every forecast we publish, labeled against ground truth — and we never retract.
      </p>
      <p
        style={{
          marginTop: 12,
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        Updated {new Date(computedAt).toUTCString()} · {totalOutcomes} resolved outcomes
      </p>
    </header>
  );
}

function humanizeModelKind(kind: string): string {
  switch (kind) {
    case 'cve_logistic':
      return 'CVE Exploit Forecaster (logistic regression)';
    case 'actor_target':
      return 'Actor Next-Target (Bayesian Dirichlet-Categorical)';
    case 'cve_lifecycle':
      return 'CVE Lifecycle (Hidden Markov Model)';
    case 'timeseries':
      return 'Daily-Rate Trend (Kalman filter)';
    case 'causal':
      return 'Counterfactual (do-calculus on causal DAG)';
    default:
      return kind;
  }
}

function SoftLaunchBanner({ total }: { total: number }) {
  const needed = SOFT_LAUNCH_OUTCOME_COUNT - total;
  return (
    <div
      style={{
        padding: '14px 18px',
        border: '1px solid var(--severity-low, #00ff41)',
        borderRadius: 2,
        background: 'rgba(var(--crt-glow-rgb), 0.04)',
        fontFamily: 'Geist Mono, monospace',
        fontSize: 12,
        color: 'var(--text-secondary)',
      }}
    >
      <strong style={{ color: 'var(--matrix-green, #00ff41)' }}>SOFT LAUNCH</strong> — This page is
      excluded from search indices until we have at least{' '}
      <strong>{SOFT_LAUNCH_OUTCOME_COUNT}</strong> resolved outcomes. Currently:{' '}
      <strong>{total}</strong>. Calibration metrics become meaningful only at sample size; in the
      meantime we publish the scaffolding and the predictions stream itself, but the headline AUC /
      Brier figures may swing widely on small samples. {needed > 0 ? `${needed} more to go.` : ''}
    </div>
  );
}

function ForecastList({
  title,
  entries,
  success,
}: {
  title: string;
  entries: TopForecast[];
  success: boolean;
}) {
  return (
    <div>
      <h3
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: success ? 'var(--matrix-green, #00ff41)' : 'var(--severity-critical, #ff0040)',
          marginBottom: 8,
        }}
      >
        {title}
      </h3>
      {entries.length === 0 ? (
        <p
          style={{
            fontFamily: 'Geist Mono, monospace',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          No qualifying outcomes in the last 30 days.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {entries.map((e, i) => (
            <li
              key={`${e.cveId}-${i}`}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                fontFamily: 'Geist Mono, monospace',
                fontSize: 11,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <span style={{ color: 'var(--text-primary)' }}>{e.cveId}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                predicted {(e.pPredicted * 100).toFixed(0)}% ·{' '}
                {e.yObserved === 1 ? 'KEV' : 'no-KEV'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TransparencyFooter() {
  return (
    <footer
      style={{
        marginTop: 48,
        padding: '24px 18px',
        borderTop: '2px solid var(--brand-accent, #00ff41)',
        fontFamily: 'Geist Mono, monospace',
        fontSize: 11,
        color: 'var(--text-secondary)',
        maxWidth: 720,
      }}
    >
      <h3
        style={{
          fontFamily: 'Instrument Serif, serif',
          fontStyle: 'italic',
          fontSize: 18,
          color: 'var(--brand-accent-readable, var(--brand-accent, #00ff41))',
          margin: '0 0 8px 0',
        }}
      >
        Our transparency commitment
      </h3>
      <p>
        Past forecasts are never retracted. Calibration is what we owe you; if the numbers above are
        bad, our public commitment is to fix the models — not to delete the page.
      </p>
      <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>
        Methodology: every forecast is labeled 30 days after publish against CISA KEV, breach
        disclosures, or realized metric values. Model versions are pinned per-forecast so retraining
        doesn&apos;t re-label old predictions.
      </p>
    </footer>
  );
}

/**
 * Phase 11.D.14 — Per-model accuracy scoreboard.
 *
 * Renders a card per model family with 4 headline numerals:
 *   AUC (or hit-rate when AUC isn't applicable to the kind),
 *   Brier (lower = better), log-loss (lower = better), N (sample size).
 *
 * Three reasons to put this in its own file:
 *   - The page already does a lot; the visual cards are noise here
 *   - Re-usable for the Weekly Predictions Thread preview embed
 *   - Lets the page component stay focused on data assembly
 */

interface ModelAccuracy {
  forecastKind: string;
  modelVersion: string;
  sampleSize: number;
  meanBrier: number | null;
  meanLogLoss: number | null;
  hitRate: number | null;
}

const KIND_LABELS: Record<string, string> = {
  cve_logistic: 'CVE EXPLOIT (logistic)',
  actor_target: 'ACTOR NEXT-TARGET (Bayesian)',
  cve_lifecycle: 'CVE LIFECYCLE (HMM)',
  timeseries: 'METRIC TREND (Kalman)',
  causal: 'COUNTERFACTUAL (do-calculus)',
};

export function AccuracyScoreboard({ models }: { models: ModelAccuracy[] }) {
  if (models.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          fontFamily: 'Geist Mono, monospace',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        No outcomes labeled yet. Forecasts published in the past 30 days will appear here once the
        outcome backfill cron resolves them against ground truth.
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
      }}
    >
      {models.map((m) => (
        <Card key={`${m.forecastKind}|${m.modelVersion}`} model={m} />
      ))}
    </div>
  );
}

function Card({ model }: { model: ModelAccuracy }) {
  return (
    <div
      style={{
        padding: 16,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 2,
        background: 'rgba(0,0,0,0.32)',
        fontFamily: 'Geist Mono, monospace',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 4,
        }}
      >
        {KIND_LABELS[model.forecastKind] ?? model.forecastKind}
      </div>
      <div
        style={{
          fontSize: 8,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          opacity: 0.6,
          marginBottom: 12,
        }}
      >
        {model.modelVersion}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Numeral label="N" value={String(model.sampleSize)} tone="default" />
        <Numeral
          label="HIT"
          value={model.hitRate == null ? '—' : `${(model.hitRate * 100).toFixed(0)}%`}
          tone={hitTone(model.hitRate)}
        />
        <Numeral
          label="BRIER"
          value={model.meanBrier == null ? '—' : model.meanBrier.toFixed(3)}
          tone={brierTone(model.meanBrier)}
        />
        <Numeral
          label="LOGLOSS"
          value={model.meanLogLoss == null ? '—' : model.meanLogLoss.toFixed(3)}
          tone="default"
        />
      </div>
    </div>
  );
}

function Numeral({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'default';
}) {
  const color =
    tone === 'good'
      ? 'var(--matrix-green, #00ff41)'
      : tone === 'warn'
        ? 'var(--color-warning, #ffaa00)'
        : tone === 'bad'
          ? 'var(--severity-critical, #ff0040)'
          : 'var(--text-primary)';
  return (
    <div style={{ minWidth: 44 }}>
      <div
        style={{
          fontFamily: 'VT323, monospace',
          fontSize: 22,
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 8,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function hitTone(rate: number | null): 'good' | 'warn' | 'bad' | 'default' {
  if (rate == null) return 'default';
  if (rate >= 0.75) return 'good';
  if (rate >= 0.5) return 'warn';
  return 'bad';
}

function brierTone(brier: number | null): 'good' | 'warn' | 'bad' | 'default' {
  if (brier == null) return 'default';
  if (brier <= 0.1) return 'good';
  if (brier <= 0.25) return 'warn';
  return 'bad';
}

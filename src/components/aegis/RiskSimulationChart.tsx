'use client';

import { Activity, AlertTriangle, BarChart3, TrendingUp } from 'lucide-react';
import type { MonteCarloResult } from '@/lib/types';

/* ─── Helpers ─── */

function fmtPct(val: number | null | undefined, decimals = 1): string {
  if (val == null) return '\u2014';
  return `${val.toFixed(decimals)}%`;
}

function fmtX(val: number | null | undefined): string {
  if (val == null) return '\u2014';
  return `${val.toFixed(2)}x`;
}

/* ─── Percentile Row ─── */

function PercentileRow({
  label,
  values,
  format,
}: {
  label: string;
  values: { p5: number; p25: number; p50: number; p75: number; p95: number };
  format: (v: number) => string;
}) {
  return (
    <tr className="border-b border-[var(--border-subtle)]">
      <td className="py-1 text-[var(--text-dim)] uppercase tracking-wider font-semibold">
        {label}
      </td>
      <td className="py-1 text-right tabular-nums text-[var(--color-negative)]">
        {format(values.p5)}
      </td>
      <td className="py-1 text-right tabular-nums text-[var(--color-warning)]">
        {format(values.p25)}
      </td>
      <td className="py-1 text-right tabular-nums text-[var(--text-primary)] font-bold">
        {format(values.p50)}
      </td>
      <td className="py-1 text-right tabular-nums text-[var(--color-info, #00ff41)]">
        {format(values.p75)}
      </td>
      <td className="py-1 text-right tabular-nums text-[var(--color-positive)]">
        {format(values.p95)}
      </td>
    </tr>
  );
}

/* ─── Probability Metric ─── */

function ProbMetric({ label, value, good }: { label: string; value: number; good: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-[var(--border-subtle)]">
      <span className="text-[9px] font-mono text-[var(--text-dim)] uppercase tracking-wider">
        {label}
      </span>
      <span
        className="text-[10px] font-mono font-medium tabular-nums"
        style={{
          color: good ? 'var(--color-positive)' : 'var(--color-negative)',
        }}
      >
        {fmtPct(value)}
      </span>
    </div>
  );
}

/* ─── RiskSimulationChart ─── */

interface RiskSimulationChartProps {
  result: MonteCarloResult;
}

export function RiskSimulationChart({ result }: RiskSimulationChartProps) {
  return (
    <div className="space-y-4">
      {/* Config info */}
      <div className="flex items-center gap-3 text-[8px] font-mono text-[var(--text-dim)]">
        <span>{result.config.runs.toLocaleString()} runs</span>
        <span>{result.config.holdYears}Y hold</span>
        <span>{result.runTimeMs}ms</span>
      </div>

      {/* Percentile Table */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <BarChart3 size={10} className="text-[var(--crt-glow)]" />
          <span
            className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em]"
            style={{ color: 'var(--crt-glow)' }}
          >
            Distribution Percentiles
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="text-left py-1 text-[var(--text-dim)] uppercase tracking-wider font-semibold">
                  Metric
                </th>
                <th className="text-right py-1 text-[var(--text-dim)] font-semibold">P5</th>
                <th className="text-right py-1 text-[var(--text-dim)] font-semibold">P25</th>
                <th className="text-right py-1 text-[var(--text-dim)] font-semibold">P50</th>
                <th className="text-right py-1 text-[var(--text-dim)] font-semibold">P75</th>
                <th className="text-right py-1 text-[var(--text-dim)] font-semibold">P95</th>
              </tr>
            </thead>
            <tbody>
              <PercentileRow label="IRR" values={result.irr} format={(v) => fmtPct(v)} />
              <PercentileRow label="MOIC" values={result.moic} format={(v) => fmtX(v)} />
              <PercentileRow label="DSCR" values={result.dscr} format={(v) => fmtX(v)} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Probability Metrics */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Activity size={10} className="text-[var(--crt-glow)]" />
          <span
            className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em]"
            style={{ color: 'var(--crt-glow)' }}
          >
            Probability Metrics
          </span>
        </div>
        <div className="space-y-0">
          <ProbMetric
            label="P(IRR > 12%)"
            value={result.probabilities.irrAbove12}
            good={result.probabilities.irrAbove12 > 50}
          />
          <ProbMetric
            label="P(IRR > 15%)"
            value={result.probabilities.irrAbove15}
            good={result.probabilities.irrAbove15 > 30}
          />
          <ProbMetric
            label="P(Loss)"
            value={result.probabilities.loss}
            good={result.probabilities.loss < 15}
          />
          <ProbMetric
            label="P(DSCR < 1.25)"
            value={result.probabilities.dscrBelow125}
            good={result.probabilities.dscrBelow125 < 20}
          />
        </div>
      </div>

      {/* Stress Scenarios */}
      {result.stressResults.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={10} className="text-[var(--color-warning)]" />
            <span
              className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em]"
              style={{ color: 'var(--crt-glow)' }}
            >
              Stress Scenarios
            </span>
          </div>
          <div className="space-y-1.5">
            {result.stressResults.map((s) => (
              <div
                key={s.scenario}
                className="p-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] font-mono font-semibold text-[var(--text-primary)]">
                    {s.scenario}
                  </span>
                  <span
                    className="text-[8px] font-mono tabular-nums"
                    style={{
                      color: s.probLoss > 25 ? 'var(--color-negative)' : 'var(--color-warning)',
                    }}
                  >
                    P(Loss): {fmtPct(s.probLoss)}
                  </span>
                </div>
                <div className="text-[8px] font-mono text-[var(--text-dim)] mb-1">
                  {s.description}
                </div>
                <div className="flex items-center gap-3 text-[8px] font-mono">
                  <span className="text-[var(--text-dim)]">
                    IRR P50:{' '}
                    <span className="text-[var(--text-primary)] tabular-nums">
                      {fmtPct(s.irrP50)}
                    </span>
                  </span>
                  <span className="text-[var(--text-dim)]">
                    MOIC P50:{' '}
                    <span className="text-[var(--text-primary)] tabular-nums">
                      {fmtX(s.moicP50)}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sensitivity */}
      {result.sensitivity.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp size={10} className="text-[var(--crt-glow)]" />
            <span
              className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em]"
              style={{ color: 'var(--crt-glow)' }}
            >
              Sensitivity Analysis
            </span>
          </div>
          <div className="space-y-0">
            {result.sensitivity.map((s) => (
              <div
                key={s.variable}
                className="flex items-center justify-between py-1 border-b border-[var(--border-subtle)]"
              >
                <span className="text-[9px] font-mono text-[var(--text-dim)]">{s.variable}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(Math.abs(s.impact) * 100, 100)}%`,
                        background:
                          s.impact > 0 ? 'var(--color-positive)' : 'var(--color-negative)',
                      }}
                    />
                  </div>
                  <span
                    className="text-[9px] font-mono tabular-nums w-8 text-right"
                    style={{
                      color: s.impact > 0 ? 'var(--color-positive)' : 'var(--color-negative)',
                    }}
                  >
                    {s.impact > 0 ? '+' : ''}
                    {(s.impact * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

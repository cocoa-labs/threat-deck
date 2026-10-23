'use client';

import { Activity, AlertTriangle, Play, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { RiskSimulationChart } from '@/components/aegis/RiskSimulationChart';
import { PanelShell } from '@/components/panels/PanelShell';
import {
  type AegisRiskSimulationInput,
  useAegisRiskSimulation,
} from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { MonteCarloResult } from '@/lib/types';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const INDUSTRY_OPTIONS = [
  'Finance',
  'Healthcare',
  'Tech',
  'Retail',
  'Manufacturing',
  'Government',
  'Other',
] as const;
type IndustryOption = (typeof INDUSTRY_OPTIONS)[number];

const GRADE_OPTIONS = ['A', 'B', 'C', 'D'] as const;
type GradeOption = (typeof GRADE_OPTIONS)[number];

const GRADE_DESCRIPTIONS: Record<GradeOption, string> = {
  A: 'Mature — low volatility',
  B: 'Standard',
  C: 'Developing',
  D: 'Nascent — high volatility',
};

/* ─── Helpers ─── */

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtMult(v: number): string {
  return `${v.toFixed(2)}x`;
}

/* ─── Stress Scenario Row (clickable, hand-rolled for click-to-agent) ─── */

function StressRow({ scenario }: { scenario: MonteCarloResult['stressResults'][number] }) {
  const lossColor =
    scenario.probLoss > 0.25
      ? 'var(--severity-critical)'
      : scenario.probLoss > 0.1
        ? 'var(--severity-high)'
        : 'var(--severity-medium)';

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `Explain the "${scenario.scenario}" stress scenario from the risk simulation. ${scenario.description} Median IRR: ${fmtPct(scenario.irrP50)}, MOIC: ${fmtMult(scenario.moicP50)}, P(Loss): ${fmtPct(scenario.probLoss)}.`,
          {
            sourcePanel: 'riskSimulation',
            dataType: 'stress_scenario',
            trendData: {
              scenario: scenario.scenario,
              description: scenario.description,
              irrP50: scenario.irrP50,
              moicP50: scenario.moicP50,
              probLoss: scenario.probLoss,
            },
          },
        )
      }
      className="w-full text-left p-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-colors hover:bg-[var(--bg-hover)] hover:border-[rgba(var(--crt-glow-rgb),0.3)] cursor-pointer"
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] font-mono font-semibold text-[var(--text-primary)]">
          {scenario.scenario}
        </span>
        <span
          className="text-[8px] font-mono tabular-nums font-semibold"
          style={{ color: lossColor }}
        >
          P(Loss): {fmtPct(scenario.probLoss)}
        </span>
      </div>
      <div className="text-[8px] font-mono text-[var(--text-dim)] mb-1 line-clamp-2">
        {scenario.description}
      </div>
      <div className="flex items-center gap-3 text-[8px] font-mono">
        <span className="text-[var(--text-dim)]">
          IRR P50:{' '}
          <span className="text-[var(--text-primary)] tabular-nums">{fmtPct(scenario.irrP50)}</span>
        </span>
        <span className="text-[var(--text-dim)]">
          MOIC P50:{' '}
          <span className="text-[var(--text-primary)] tabular-nums">
            {fmtMult(scenario.moicP50)}
          </span>
        </span>
      </div>
    </button>
  );
}

/* ─── RiskSimulationPanel ─── */

export function RiskSimulationPanel() {
  const [industry, setIndustry] = useState<IndustryOption>('Finance');
  const [revenue, setRevenue] = useState<string>('500');
  const [headcount, setHeadcount] = useState<string>('1000');
  const [grade, setGrade] = useState<GradeOption>('B');
  const [simInput, setSimInput] = useState<AegisRiskSimulationInput | null>(null);

  const { isFetching, isError, error } = useAegisRiskSimulation(simInput);
  const result = useDataStore((s) => s.riskSimulation);

  const handleRun = () => {
    const revenueNum = Number(revenue);
    if (Number.isNaN(revenueNum) || revenueNum <= 0) return;
    const headcountNum = Number(headcount);
    setSimInput({
      industry,
      revenue: revenueNum,
      headcount: Number.isNaN(headcountNum) ? 100 : Math.max(1, Math.floor(headcountNum)),
      grade,
      runs: 1000,
      horizon: 5,
    });
  };

  const canRun = !Number.isNaN(Number(revenue)) && Number(revenue) > 0;

  return (
    <PanelShell id="riskSimulation" title="RISK SIMULATION" span={1}>
      <div className="space-y-3 overflow-y-auto">
        {/* Input form */}
        <div className="p-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2">
          <div className="flex items-center gap-1.5">
            <Activity size={10} className="text-[var(--crt-glow)]" />
            <span className="text-[8px] font-mono font-semibold text-[var(--crt-glow)] uppercase tracking-wider">
              Profile
            </span>
          </div>

          {/* Industry */}
          <label className="flex flex-col gap-0.5">
            <span className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
              Industry
            </span>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value as IndustryOption)}
              className="text-[9px] font-mono bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded px-1.5 py-1 cursor-pointer"
            >
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          {/* Revenue */}
          <label className="flex flex-col gap-0.5">
            <span className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
              Annual Revenue ($M)
            </span>
            <input
              type="number"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              min="1"
              step="10"
              className="text-[9px] font-mono bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded px-1.5 py-1 tabular-nums"
            />
          </label>

          {/* Headcount */}
          <label className="flex flex-col gap-0.5">
            <span className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
              Headcount
            </span>
            <input
              type="number"
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              min="1"
              step="50"
              className="text-[9px] font-mono bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded px-1.5 py-1 tabular-nums"
            />
          </label>

          {/* Security maturity grade */}
          <label className="flex flex-col gap-0.5">
            <span className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
              Security Maturity
            </span>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value as GradeOption)}
              className="text-[9px] font-mono bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded px-1.5 py-1 cursor-pointer"
            >
              {GRADE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g} — {GRADE_DESCRIPTIONS[g]}
                </option>
              ))}
            </select>
          </label>

          {/* Run button */}
          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun || isFetching}
            className="w-full flex items-center justify-center gap-1.5 text-[9px] font-mono font-semibold text-[var(--crt-glow)] px-2 py-1.5 rounded border border-[var(--crt-glow)] hover:bg-[rgba(var(--crt-glow-rgb),0.1)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={10} />
            {isFetching ? 'RUNNING…' : 'RUN SIMULATION'}
          </button>
        </div>

        {/* Error */}
        {isError && (
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-[var(--severity-high)] p-2 rounded border border-[var(--severity-high)]">
            <AlertTriangle size={10} />
            <span>
              Simulation failed: {error instanceof Error ? error.message : 'unknown error'}
            </span>
          </div>
        )}

        {/* Results */}
        {result && !isFetching && (
          <>
            {/* Percentile table + probability metrics + sensitivity (shared renderer) */}
            <RiskSimulationChart result={{ ...result, stressResults: [] }} />

            {/* Render stress scenarios ourselves so click-to-agent works */}
            {result.stressResults.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <TrendingUp size={10} className="text-[var(--severity-medium)]" />
                  <span className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em] text-[var(--crt-glow)]">
                    Stress Scenarios
                  </span>
                </div>
                <div className="space-y-1.5">
                  {result.stressResults.map((s) => (
                    <StressRow key={s.scenario} scenario={s} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!result && !isFetching && (
          <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
            <Activity size={16} className="text-[var(--text-muted)]" />
            <span className="text-[9px] font-mono text-[var(--text-muted)]">
              Configure profile and run simulation
            </span>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

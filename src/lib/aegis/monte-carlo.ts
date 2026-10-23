import {
  CHOLESKY_L,
  DEFAULT_AMORT_YEARS,
  DEFAULT_HOLD_YEARS,
  DEFAULT_INTEREST_RATE,
  DEFAULT_LTV,
  DEFAULT_RUNS,
  GRADE_VOLATILITY,
  IRR_EPSILON,
  IRR_INITIAL_GUESS,
  IRR_MAX_ITERATIONS,
  STRESS_RUNS,
  STRESS_SCENARIOS,
} from './constants';
import type {
  CollateralInput,
  PercentileResult,
  SimConfig,
  SimResults,
  StressAdjustments,
  VolatilityParams,
} from './types';

// ── Seedable PRNG (Mulberry32) ───────────────────────────────────────────────
// Deterministic, fast, 32-bit. Good enough for Monte Carlo — not crypto.

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Box-Muller Transform ─────────────────────────────────────────────────────
// Converts two uniform [0,1) samples into two standard normal samples.
// Returns one value per call, caches the spare.

export function createBoxMuller(rng: () => number): () => number {
  let hasSpare = false;
  let spare = 0;

  return () => {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }

    let u: number;
    let v: number;
    let s: number;

    // Marsaglia polar method (rejection sampling variant — avoids trig)
    do {
      u = 2.0 * rng() - 1.0;
      v = 2.0 * rng() - 1.0;
      s = u * u + v * v;
    } while (s >= 1.0 || s === 0.0);

    const mul = Math.sqrt((-2.0 * Math.log(s)) / s);
    spare = v * mul;
    hasSpare = true;
    return u * mul;
  };
}

// ── Correlated Normal Samples ────────────────────────────────────────────────
// Uses pre-computed Cholesky L to transform 4 independent normals into
// correlated [rentGrowth, vacancy, opexInflation, exitCapRate] samples.

export function correlatedSamples(
  normal: () => number,
  vol: VolatilityParams,
  stress: StressAdjustments,
): { rentGrowth: number; vacancy: number; opexInflation: number; exitCapRate: number } {
  // 4 independent standard normals
  const z = [normal(), normal(), normal(), normal()];

  // Multiply by Cholesky L to get correlated standard normals
  const corr = new Array<number>(4);
  for (let i = 0; i < 4; i++) {
    let sum = 0;
    for (let j = 0; j <= i; j++) {
      sum += CHOLESKY_L[i]![j]! * z[j]!;
    }
    corr[i] = sum;
  }

  // Scale to actual distributions: mean + std * correlated_normal + stress shock
  return {
    rentGrowth: vol.rentGrowthMean + vol.rentGrowthStd * corr[0]! + stress.rentGrowthShock,
    vacancy: Math.max(
      0,
      Math.min(1, vol.vacancyMean + vol.vacancyStd * corr[1]! + stress.vacancyShock),
    ),
    opexInflation: vol.opexInflationMean + vol.opexInflationStd * corr[2]! + stress.opexShock,
    exitCapRate: Math.max(
      0.01,
      vol.exitCapRateMean + vol.exitCapRateStd * corr[3]! + stress.exitCapRateShock,
    ),
  };
}

// ── Newton-Raphson IRR Solver ────────────────────────────────────────────────
// Finds rate r where NPV(cashFlows, r) = 0.

export function computeIRR(cashFlows: number[]): number {
  if (cashFlows.length < 2) return 0;

  let rate = IRR_INITIAL_GUESS;

  for (let iter = 0; iter < IRR_MAX_ITERATIONS; iter++) {
    let npv = 0;
    let dnpv = 0; // derivative of NPV w.r.t. rate

    for (let t = 0; t < cashFlows.length; t++) {
      const cf = cashFlows[t]!;
      const factor = (1 + rate) ** t;
      npv += cf / factor;
      if (t > 0) {
        dnpv -= (t * cf) / (factor * (1 + rate));
      }
    }

    if (Math.abs(npv) < IRR_EPSILON) return rate;

    // Guard against zero derivative (flat NPV curve)
    if (Math.abs(dnpv) < 1e-15) break;

    const newRate = rate - npv / dnpv;

    // Clamp to prevent divergence
    if (newRate < -0.99) {
      rate = -0.5;
    } else if (newRate > 10.0) {
      rate = 5.0;
    } else {
      rate = newRate;
    }
  }

  // Convergence failure — return best guess
  return rate;
}

// ── MOIC Calculation ─────────────────────────────────────────────────────────
// Multiple on Invested Capital = total distributions / total invested

export function computeMOIC(cashFlows: number[]): number {
  let totalInvested = 0;
  let totalDistributed = 0;

  for (const cf of cashFlows) {
    if (cf < 0) {
      totalInvested += Math.abs(cf);
    } else {
      totalDistributed += cf;
    }
  }

  if (totalInvested === 0) return 0;
  return totalDistributed / totalInvested;
}

// ── DSCR Calculation ─────────────────────────────────────────────────────────
// Debt Service Coverage Ratio = NOI / annual debt service
// Uses interest-only approximation for speed (conservative estimate)

export function computeDSCR(noi: number, loanAmount: number, interestRate: number): number {
  if (loanAmount <= 0 || interestRate <= 0) return Infinity;

  // Full amortizing payment: P * [r(1+r)^n] / [(1+r)^n - 1]
  const monthlyRate = interestRate / 12;
  const numPayments = DEFAULT_AMORT_YEARS * 12;
  const monthlyPayment =
    (loanAmount * (monthlyRate * (1 + monthlyRate) ** numPayments)) /
    ((1 + monthlyRate) ** numPayments - 1);
  const annualDebtService = monthlyPayment * 12;

  if (annualDebtService <= 0) return Infinity;
  return noi / annualDebtService;
}

// ── Percentile Computation ───────────────────────────────────────────────────

export function computePercentiles(values: number[]): PercentileResult {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;

  if (n === 0) {
    return { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 };
  }

  const pct = (p: number): number => {
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo]!;
    const frac = idx - lo;
    return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
  };

  return {
    p5: pct(5),
    p25: pct(25),
    p50: pct(50),
    p75: pct(75),
    p95: pct(95),
  };
}

// ── Single Simulation Run ────────────────────────────────────────────────────
// Generates one cash flow path and returns IRR, MOIC, and year-1 DSCR.

interface SingleRunResult {
  irr: number;
  moic: number;
  dscr: number;
}

function simulateSingleRun(
  collateral: CollateralInput,
  vol: VolatilityParams,
  stress: StressAdjustments,
  holdYears: number,
  normal: () => number,
): SingleRunResult {
  const { purchasePrice, noi } = collateral;
  const loanAmount = purchasePrice * DEFAULT_LTV;
  const equityInvested = purchasePrice - loanAmount;

  // Build cash flow series: Year 0 = equity outlay (negative)
  const cashFlows: number[] = [-equityInvested];

  let currentNOI = noi;
  let year1DSCR = 0;

  for (let year = 1; year <= holdYears; year++) {
    // Draw correlated random variables for this year
    const draws = correlatedSamples(normal, vol, stress);

    // Grow NOI by rent growth, then reduce by vacancy drag
    currentNOI = currentNOI * (1 + draws.rentGrowth);

    // Effective NOI after vacancy
    const effectiveNOI = currentNOI * (1 - draws.vacancy);

    // Operating expenses grow with inflation — reduce NOI
    // OpEx is modeled as a fraction of NOI for simplicity
    const opexDrag = effectiveNOI * draws.opexInflation;
    const netCashFlow = effectiveNOI - opexDrag;

    // Annual debt service
    const annualDebtService = computeAnnualDebtService(loanAmount, DEFAULT_INTEREST_RATE);

    // Cash flow to equity = net cash flow - debt service
    const cfToEquity = netCashFlow - annualDebtService;

    if (year === 1) {
      year1DSCR = netCashFlow > 0 ? netCashFlow / annualDebtService : 0;
    }

    if (year < holdYears) {
      cashFlows.push(cfToEquity);
    } else {
      // Terminal year: sale proceeds + final year cash flow
      const terminalValue = netCashFlow / draws.exitCapRate;
      const saleProceeds = terminalValue - loanAmount; // pay off loan at sale
      cashFlows.push(cfToEquity + saleProceeds);
    }
  }

  return {
    irr: computeIRR(cashFlows),
    moic: computeMOIC(cashFlows),
    dscr: year1DSCR,
  };
}

// ── Debt Service Helper ──────────────────────────────────────────────────────

function computeAnnualDebtService(loanAmount: number, interestRate: number): number {
  const monthlyRate = interestRate / 12;
  const numPayments = DEFAULT_AMORT_YEARS * 12;
  const monthlyPayment =
    (loanAmount * (monthlyRate * (1 + monthlyRate) ** numPayments)) /
    ((1 + monthlyRate) ** numPayments - 1);
  return monthlyPayment * 12;
}

// ── Batch Simulation ─────────────────────────────────────────────────────────
// Runs N simulations with given stress adjustments and returns raw results.

function runBatch(
  collateral: CollateralInput,
  vol: VolatilityParams,
  stress: StressAdjustments,
  runs: number,
  holdYears: number,
  rng: () => number,
): SingleRunResult[] {
  const normal = createBoxMuller(rng);
  const results: SingleRunResult[] = new Array(runs);

  for (let i = 0; i < runs; i++) {
    results[i] = simulateSingleRun(collateral, vol, stress, holdYears, normal);
  }

  return results;
}

// ── Tornado Sensitivity Analysis ─────────────────────────────────────────────
// Measures each variable's impact on median IRR by shocking +/- 1 std dev
// one variable at a time, holding others at baseline.

function computeSensitivity(
  collateral: CollateralInput,
  vol: VolatilityParams,
  holdYears: number,
  seed: number,
): Array<{ variable: string; impact: number }> {
  const sensRuns = 250;
  const variables: Array<{
    name: string;
    key: keyof StressAdjustments;
    stdKey: keyof VolatilityParams;
  }> = [
    { name: 'Rent Growth', key: 'rentGrowthShock', stdKey: 'rentGrowthStd' },
    { name: 'Vacancy', key: 'vacancyShock', stdKey: 'vacancyStd' },
    { name: 'OpEx Inflation', key: 'opexShock', stdKey: 'opexInflationStd' },
    { name: 'Exit Cap Rate', key: 'exitCapRateShock', stdKey: 'exitCapRateStd' },
  ];

  const noStress: StressAdjustments = {
    rentGrowthShock: 0,
    vacancyShock: 0,
    opexShock: 0,
    exitCapRateShock: 0,
  };

  // Baseline median IRR
  const baseRng = mulberry32(seed + 9999);
  const baseResults = runBatch(collateral, vol, noStress, sensRuns, holdYears, baseRng);
  const baseMedianIRR = computePercentiles(baseResults.map((r) => r.irr)).p50;

  const sensitivity: Array<{ variable: string; impact: number }> = [];

  for (const v of variables) {
    const stdDev = vol[v.stdKey];

    // +1 std dev shock
    const upStress = { ...noStress, [v.key]: stdDev };
    const upRng = mulberry32(seed + 10000 + variables.indexOf(v));
    const upResults = runBatch(collateral, vol, upStress, sensRuns, holdYears, upRng);
    const upMedianIRR = computePercentiles(upResults.map((r) => r.irr)).p50;

    // -1 std dev shock
    const downStress = { ...noStress, [v.key]: -stdDev };
    const downRng = mulberry32(seed + 20000 + variables.indexOf(v));
    const downResults = runBatch(collateral, vol, downStress, sensRuns, holdYears, downRng);
    const downMedianIRR = computePercentiles(downResults.map((r) => r.irr)).p50;

    // Impact = average of absolute changes from baseline
    const upDelta = Math.abs(upMedianIRR - baseMedianIRR);
    const downDelta = Math.abs(downMedianIRR - baseMedianIRR);
    const impact = (upDelta + downDelta) / 2;
    sensitivity.push({ variable: v.name, impact });
  }

  // Sort descending by impact (highest sensitivity first)
  sensitivity.sort((a, b) => b.impact - a.impact);
  return sensitivity;
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

export function runMonteCarloSimulation(
  collateral: CollateralInput,
  config?: Partial<SimConfig>,
): SimResults {
  const startTime = performance.now();

  // Resolve config with defaults
  const runs = config?.runs ?? DEFAULT_RUNS;
  const holdYears = config?.holdYears ?? DEFAULT_HOLD_YEARS;
  const seed = config?.seed ?? Date.now() ^ 0xdeadbeef;

  const resolvedConfig: SimConfig = { runs, holdYears, seed };

  // Look up volatility params by market grade
  const vol = GRADE_VOLATILITY[collateral.marketGrade];
  if (!vol) {
    throw new Error(`Unknown market grade: ${collateral.marketGrade}`);
  }

  // Base stress (no shocks, or user-provided overrides)
  const baseStress: StressAdjustments = {
    rentGrowthShock: config?.scenarioOverrides?.rentGrowthShock ?? 0,
    vacancyShock: config?.scenarioOverrides?.vacancyShock ?? 0,
    opexShock: config?.scenarioOverrides?.opexShock ?? 0,
    exitCapRateShock: config?.scenarioOverrides?.exitCapRateShock ?? 0,
  };

  // ── Primary simulation run ──
  const primaryRng = mulberry32(seed);
  const primaryResults = runBatch(collateral, vol, baseStress, runs, holdYears, primaryRng);

  const irrs = primaryResults.map((r) => r.irr);
  const moics = primaryResults.map((r) => r.moic);
  const dscrs = primaryResults.map((r) => r.dscr);

  // ── Probability calculations ──
  const irrAbove12 = irrs.filter((v) => v > 0.12).length / runs;
  const irrAbove15 = irrs.filter((v) => v > 0.15).length / runs;
  const loss = moics.filter((v) => v < 1.0).length / runs;
  const dscrBelow125 = dscrs.filter((v) => v < 1.25).length / runs;

  // ── Stress scenario runs ──
  const stressResults = STRESS_SCENARIOS.map((scenario, idx) => {
    const stressAdj: StressAdjustments = {
      rentGrowthShock: baseStress.rentGrowthShock + scenario.adjustments.rentGrowthShock,
      vacancyShock: baseStress.vacancyShock + scenario.adjustments.vacancyShock,
      opexShock: baseStress.opexShock + scenario.adjustments.opexShock,
      exitCapRateShock: baseStress.exitCapRateShock + scenario.adjustments.exitCapRateShock,
    };

    const stressRng = mulberry32(seed + 1000 + idx);
    const results = runBatch(collateral, vol, stressAdj, STRESS_RUNS, holdYears, stressRng);

    const stressIRRs = results.map((r) => r.irr);
    const stressMOICs = results.map((r) => r.moic);

    return {
      scenario: scenario.name,
      description: scenario.description,
      irrP50: computePercentiles(stressIRRs).p50,
      moicP50: computePercentiles(stressMOICs).p50,
      probLoss: stressMOICs.filter((v) => v < 1.0).length / STRESS_RUNS,
    };
  });

  // ── Tornado sensitivity ──
  const sensitivity = computeSensitivity(collateral, vol, holdYears, seed);

  const runTimeMs = performance.now() - startTime;

  return {
    irr: computePercentiles(irrs),
    moic: computePercentiles(moics),
    dscr: computePercentiles(dscrs),
    probabilities: {
      irrAbove12,
      irrAbove15,
      loss,
      dscrBelow125,
    },
    stressResults,
    sensitivity,
    config: resolvedConfig,
    runTimeMs,
  };
}

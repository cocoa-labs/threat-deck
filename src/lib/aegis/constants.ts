import type { StressScenario, VolatilityParams } from './types';

// ── Grade-Based Volatility Parameters ────────────────────────────────────────
// A = institutional quality, low vol; D = distressed, high vol
export const GRADE_VOLATILITY: Record<string, VolatilityParams> = {
  A: {
    rentGrowthMean: 0.03,
    rentGrowthStd: 0.015,
    vacancyMean: 0.05,
    vacancyStd: 0.02,
    opexInflationMean: 0.025,
    opexInflationStd: 0.01,
    exitCapRateMean: 0.05,
    exitCapRateStd: 0.005,
  },
  B: {
    rentGrowthMean: 0.025,
    rentGrowthStd: 0.02,
    vacancyMean: 0.07,
    vacancyStd: 0.03,
    opexInflationMean: 0.03,
    opexInflationStd: 0.015,
    exitCapRateMean: 0.055,
    exitCapRateStd: 0.008,
  },
  C: {
    rentGrowthMean: 0.02,
    rentGrowthStd: 0.03,
    vacancyMean: 0.1,
    vacancyStd: 0.04,
    opexInflationMean: 0.035,
    opexInflationStd: 0.02,
    exitCapRateMean: 0.065,
    exitCapRateStd: 0.012,
  },
  D: {
    rentGrowthMean: 0.01,
    rentGrowthStd: 0.04,
    vacancyMean: 0.15,
    vacancyStd: 0.06,
    opexInflationMean: 0.04,
    opexInflationStd: 0.025,
    exitCapRateMean: 0.08,
    exitCapRateStd: 0.02,
  },
};

// ── Correlation Matrix ───────────────────────────────────────────────────────
// 4x4 for [rentGrowth, vacancy, opexInflation, exitCapRate]
// Pre-computed for performance — no need for runtime Cholesky
export const CORRELATION_MATRIX: number[][] = [
  [1.0, -0.4, 0.3, -0.2],
  [-0.4, 1.0, 0.1, 0.5],
  [0.3, 0.1, 1.0, 0.15],
  [-0.2, 0.5, 0.15, 1.0],
];

// Pre-computed Cholesky decomposition of CORRELATION_MATRIX
// Lower triangular L where LL^T = C
export const CHOLESKY_L: number[][] = [
  [1.0, 0.0, 0.0, 0.0],
  [-0.4, 0.9165, 0.0, 0.0],
  [0.3, 0.2398, 0.9234, 0.0],
  [-0.2, 0.4581, 0.2079, 0.8394],
];

// ── Stress Scenarios ─────────────────────────────────────────────────────────
export const STRESS_SCENARIOS: StressScenario[] = [
  {
    name: 'Base Case',
    description: 'No stress adjustments applied',
    adjustments: {
      rentGrowthShock: 0,
      vacancyShock: 0,
      opexShock: 0,
      exitCapRateShock: 0,
    },
  },
  {
    name: 'Mild Recession',
    description: 'Moderate economic slowdown',
    adjustments: {
      rentGrowthShock: -0.02,
      vacancyShock: 0.03,
      opexShock: 0.01,
      exitCapRateShock: 0.005,
    },
  },
  {
    name: 'Severe Recession',
    description: 'Deep economic contraction',
    adjustments: {
      rentGrowthShock: -0.05,
      vacancyShock: 0.08,
      opexShock: 0.02,
      exitCapRateShock: 0.015,
    },
  },
  {
    name: 'Rate Spike',
    description: 'Sharp interest rate increase',
    adjustments: {
      rentGrowthShock: -0.01,
      vacancyShock: 0.02,
      opexShock: 0.015,
      exitCapRateShock: 0.02,
    },
  },
  {
    name: 'Supply Glut',
    description: 'Oversupply in local market',
    adjustments: {
      rentGrowthShock: -0.03,
      vacancyShock: 0.06,
      opexShock: 0,
      exitCapRateShock: 0.01,
    },
  },
  {
    name: 'Bull Case',
    description: 'Strong economic expansion',
    adjustments: {
      rentGrowthShock: 0.02,
      vacancyShock: -0.02,
      opexShock: -0.005,
      exitCapRateShock: -0.005,
    },
  },
];

// ── Financing Assumptions ────────────────────────────────────────────────────
export const DEFAULT_LTV = 0.65;
export const DEFAULT_INTEREST_RATE = 0.06;
export const DEFAULT_AMORT_YEARS = 30;

// ── Simulation Defaults ──────────────────────────────────────────────────────
export const DEFAULT_RUNS = 1000;
export const DEFAULT_HOLD_YEARS = 5;
export const STRESS_RUNS = 250; // fewer runs per stress scenario for speed

// ── IRR Solver ───────────────────────────────────────────────────────────────
export const IRR_MAX_ITERATIONS = 50;
export const IRR_EPSILON = 1e-7;
export const IRR_INITIAL_GUESS = 0.1;

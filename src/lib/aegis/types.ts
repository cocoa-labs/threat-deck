// ── AEGIS Monte Carlo Simulation Types ───────────────────────────────────────

export interface SimConfig {
  runs: number; // default 1000
  holdYears: number; // default 5
  seed?: number; // optional seed for reproducibility
  scenarioOverrides?: Partial<StressAdjustments>;
}

export interface CollateralInput {
  purchasePrice: number;
  noi: number;
  capRate: number;
  units: number;
  yearBuilt: number;
  occupancyPct: number;
  marketGrade: 'A' | 'B' | 'C' | 'D';
  msaCode?: string;
}

export interface VolatilityParams {
  rentGrowthMean: number;
  rentGrowthStd: number;
  vacancyMean: number;
  vacancyStd: number;
  opexInflationMean: number;
  opexInflationStd: number;
  exitCapRateMean: number;
  exitCapRateStd: number;
}

export interface StressAdjustments {
  rentGrowthShock: number;
  vacancyShock: number;
  opexShock: number;
  exitCapRateShock: number;
}

export interface StressScenario {
  name: string;
  description: string;
  adjustments: StressAdjustments;
}

export interface PercentileResult {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface SimResults {
  irr: PercentileResult;
  moic: PercentileResult;
  dscr: PercentileResult;
  probabilities: {
    irrAbove12: number;
    irrAbove15: number;
    loss: number;
    dscrBelow125: number;
  };
  stressResults: Array<{
    scenario: string;
    description: string;
    irrP50: number;
    moicP50: number;
    probLoss: number;
  }>;
  sensitivity: Array<{
    variable: string;
    impact: number; // absolute change in median IRR per 1 std dev
  }>;
  config: SimConfig;
  runTimeMs: number;
}

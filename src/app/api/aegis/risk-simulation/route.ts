import { NextResponse } from 'next/server';
import { runMonteCarloSimulation } from '@/lib/aegis/monte-carlo';
import type { CollateralInput, SimConfig } from '@/lib/aegis/types';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/risk-simulation
 *
 * Runs a Monte Carlo cyber risk simulation for an organization profile and
 * returns the raw simulation envelope so the panel can render it via
 * AtlasMonteCarloChart (domain-neutral component).
 *
 * Maps cyber inputs to the engine's CollateralInput shape:
 *   purchasePrice ← annual revenue (exposure base)
 *   noi          ← revenue × 0.12 (margin proxy)
 *   units        ← headcount
 *   marketGrade  ← security maturity grade (A/B/C/D)
 *
 * Query params:
 *   - industry: string (informational, included in profile)
 *   - revenue: number (millions USD, required)
 *   - headcount: number (default 100)
 *   - grade: A | B | C | D (default B)
 *   - runs: 100..5000 (default 1000)
 *   - horizon: 1..5 years (default 5)
 *   - seed: number (optional, for reproducibility)
 *
 * No caching — results vary by query.
 */

const VALID_GRADES = new Set(['A', 'B', 'C', 'D']);

async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);

  const industry = searchParams.get('industry')?.trim() ?? null;
  const revenueParam = searchParams.get('revenue');
  const headcountParam = searchParams.get('headcount');
  const gradeParam = searchParams.get('grade')?.toUpperCase();
  const runsParam = searchParams.get('runs');
  const horizonParam = searchParams.get('horizon');
  const seedParam = searchParams.get('seed');

  // Validate revenue (millions USD, must be > 0)
  const revenueMillions = revenueParam !== null ? Number(revenueParam) : Number.NaN;
  if (Number.isNaN(revenueMillions) || revenueMillions <= 0) {
    return NextResponse.json(
      { error: 'Query param "revenue" (millions USD) is required and must be > 0' },
      { status: 400 },
    );
  }

  const annualRevenueUsd = revenueMillions * 1_000_000;
  const headcount =
    headcountParam !== null && !Number.isNaN(Number(headcountParam))
      ? Math.max(1, Math.floor(Number(headcountParam)))
      : 100;
  const grade =
    gradeParam && VALID_GRADES.has(gradeParam) ? (gradeParam as 'A' | 'B' | 'C' | 'D') : 'B';

  // Bound config values defensively
  const runs =
    runsParam !== null && !Number.isNaN(Number(runsParam))
      ? Math.min(Math.max(Math.floor(Number(runsParam)), 100), 5000)
      : 1000;
  const horizon =
    horizonParam !== null && !Number.isNaN(Number(horizonParam))
      ? Math.min(Math.max(Math.floor(Number(horizonParam)), 1), 5)
      : 5;
  const seed =
    seedParam !== null && !Number.isNaN(Number(seedParam)) ? Number(seedParam) : undefined;

  try {
    const collateralInput: CollateralInput = {
      purchasePrice: annualRevenueUsd,
      noi: annualRevenueUsd * 0.12,
      capRate: 0.06,
      units: headcount,
      yearBuilt: 2020,
      occupancyPct: 0.95,
      marketGrade: grade,
    };

    const simConfig: Partial<SimConfig> = { runs, holdYears: horizon };
    if (seed !== undefined) simConfig.seed = seed;

    const results = runMonteCarloSimulation(collateralInput, simConfig);

    return NextResponse.json(
      {
        data: results,
        profile: {
          industry,
          revenueMillionsUsd: revenueMillions,
          headcount,
          securityMaturityGrade: grade,
        },
        sourceUrl: '/api/aegis/risk-simulation/view',
        timestamp: new Date().toISOString(),
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (err) {
    console.error('[aegis/risk-simulation] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Risk simulation failed' },
      { status: 500 },
    );
  }
}

export const GET = withRoutePolicy('/api/aegis/risk-simulation', routeGETImplementation);

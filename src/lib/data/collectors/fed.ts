import { safeFetch } from '@/lib/security/safe-fetch';
import type { FedData } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const API_KEY = () => process.env.FRED_API_KEY;

// Fail fast: FRED p50 ≈ 130ms. Abort slow/hung sockets so a degraded FRED edge
// (e.g. Akamai 502/504) never blocks the route waiting on the slowest series.
const FRED_TIMEOUT_MS = 6000;
// Long-lived last-known-good snapshot, served (flagged stale) during a FRED outage.
const LASTGOOD_KEY = 'fed:lastgood:v3';
const LASTGOOD_TTL_SECONDS = 604_800; // 7 days

// ─── Series Mapping ───

// Indicators that should display YoY % change instead of raw index level
const YOY_INDICATORS = new Set(['cpi', 'pce']);

const SERIES_MAP: Record<string, string> = {
  balance_sheet: 'WALCL',
  m2: 'M2SL',
  fed_funds: 'FEDFUNDS',
  unemployment: 'UNRATE',
  gdp: 'GDP',
  cpi: 'CPIAUCSL',
  pce: 'PCEPI',
  treasury_10y: 'DGS10',
  yield_spread: 'T10Y2Y',
  initial_claims: 'ICSA',
  industrial_production: 'INDPRO',
  consumer_sentiment: 'UMCSENT',
  retail_sales: 'RSXFS',
  housing_starts: 'HOUST',
};

// ─── Fallback Demo Data ───

const DEMO_FED: FedData = {
  balanceSheet: { value: 7_450_000, change: -0.43, date: '2026-01-29' },
  m2: { value: 21_220, change: 0.4, date: '2025-12-01' },
  fedFunds: { value: 4.33, date: '2026-01-01' },
  unemployment: { value: 4.1, date: '2025-12-01' },
  gdp: { value: 28_781.5, change: 2.0, date: '2025-09-01' },
  cpi: { value: 2.9, change: -0.2, date: '2025-12-01' },
  pce: { value: 2.6, change: -0.1, date: '2025-11-01' },
  treasury10Y: { value: 4.52, date: '2026-01-31' },
  yieldSpread: { value: 0.33, date: '2026-01-31' },
  initialClaims: { value: 219_000, change: -2.74, date: '2026-01-25' },
  industrialProduction: { value: 103.5, change: 0.3, date: '2025-12-01' },
  consumerSentiment: { value: 71.1, change: -2.8, date: '2026-01-01' },
  retailSales: { value: 724_800, change: 0.4, date: '2025-12-01' },
  housingStarts: { value: 1_499, change: 3.2, date: '2025-12-01' },
};

// ─── Backfill Helper ───

const DEMO_KEY_MAP: Record<string, keyof FedData> = {
  balance_sheet: 'balanceSheet',
  m2: 'm2',
  fed_funds: 'fedFunds',
  unemployment: 'unemployment',
  gdp: 'gdp',
  cpi: 'cpi',
  pce: 'pce',
  treasury_10y: 'treasury10Y',
  yield_spread: 'yieldSpread',
  initial_claims: 'initialClaims',
  industrial_production: 'industrialProduction',
  consumer_sentiment: 'consumerSentiment',
  retail_sales: 'retailSales',
  housing_starts: 'housingStarts',
};

/** Backfill any missing series from DEMO_FED so all 14 cards render. */
function backfillFromDemo(result: FedData): FedData {
  if (process.env.ENABLE_DEMO_DATA !== 'true') return result;
  const demoKeys: string[] = [];

  for (const [_indicator, fedKey] of Object.entries(DEMO_KEY_MAP)) {
    if (!result[fedKey] && DEMO_FED[fedKey]) {
      (result as Record<string, unknown>)[fedKey] = DEMO_FED[fedKey];
      demoKeys.push(fedKey);
    }
  }

  if (demoKeys.length > 0) {
    result._demoKeys = demoKeys;
  }

  return result;
}

/**
 * Fallback when a live FRED fetch is unavailable (outage / rate-limit / missing key).
 * Prefers last-known-good REAL data (flagged `stale`) over synthetic demo numbers, so
 * the UI never silently presents fabricated economic figures as live. Falls back to
 * demo only when no snapshot exists yet (first run), flagged `stale` + `_demo`.
 */
async function fedFallback(): Promise<FedData> {
  const lastGood = await getCached<FedData>(LASTGOOD_KEY);
  if (lastGood) {
    return backfillFromDemo({ ...lastGood, stale: true });
  }
  return process.env.ENABLE_DEMO_DATA === 'true'
    ? { ...DEMO_FED, stale: true, _demo: true }
    : { stale: true };
}

// ─── Public API ───

/**
 * Fetch Federal Reserve economic data from the FRED API.
 * Pass indicator keys like 'balance_sheet', 'm2', 'fed_funds', etc.
 * Falls back to demo data when the FRED API key is not set.
 */
export async function fetchFedData(
  indicators: string[] = [
    'balance_sheet',
    'm2',
    'fed_funds',
    'unemployment',
    'gdp',
    'cpi',
    'pce',
    'treasury_10y',
    'yield_spread',
    'initial_claims',
    'industrial_production',
    'consumer_sentiment',
    'retail_sales',
    'housing_starts',
  ],
): Promise<FedData> {
  const cacheKey = 'fed:data:v3';
  const cached = await getCached<FedData>(cacheKey);
  if (cached) return backfillFromDemo(cached);

  const apiKey = API_KEY();
  if (!apiKey) {
    return fedFallback();
  }

  if (!checkRateLimit('fred')) {
    return fedFallback();
  }

  try {
    const result: FedData = {};

    const fetches = indicators.map(async (indicator) => {
      const seriesId = SERIES_MAP[indicator];
      if (!seriesId) return;

      const isYoY = YOY_INDICATORS.has(indicator);

      try {
        const url =
          `${FRED_BASE}?series_id=${seriesId}` +
          `&api_key=${apiKey}` +
          `&file_type=json` +
          `&sort_order=desc` +
          `&limit=${isYoY ? 15 : 10}`;

        const res = await safeFetch(url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(FRED_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.warn(`[Fed] FRED API returned ${res.status} for ${seriesId}`);
          return;
        }

        const data: FredResponse = await res.json();
        const observations = data.observations ?? [];
        // Find first non-placeholder observation (FRED uses '.' for not-yet-available)
        const valid = observations.filter((o) => o.value !== '.');

        if (valid.length === 0) return;

        if (isYoY && valid.length >= 13) {
          // Compute YoY inflation rate for CPI/PCE
          const latestVal = parseFloat(valid[0]!.value);
          const yearAgoVal = parseFloat(valid[12]!.value);
          const yoyRate = ((latestVal - yearAgoVal) / yearAgoVal) * 100;

          // Compute previous month's YoY rate for acceleration/deceleration
          let change: number | undefined;
          if (valid.length >= 14) {
            const prevMonthVal = parseFloat(valid[1]!.value);
            const prevYearAgoVal = parseFloat(valid[13]!.value);
            const prevYoyRate = ((prevMonthVal - prevYearAgoVal) / prevYearAgoVal) * 100;
            change = yoyRate - prevYoyRate;
          }

          assignIndicator(result, indicator, {
            value: parseFloat(yoyRate.toFixed(2)),
            change,
            date: valid[0]!.date,
          });
        } else {
          // Standard: use raw value with month-over-month % change
          const latest = valid[0]!;
          const previous = valid.length > 1 ? valid[1] : undefined;
          const value = parseFloat(latest.value);
          const prevValue =
            previous && previous.value !== '.' ? parseFloat(previous.value) : undefined;

          assignIndicator(result, indicator, {
            value,
            change:
              prevValue !== undefined && prevValue !== 0
                ? ((value - prevValue) / prevValue) * 100
                : undefined,
            date: latest.date,
          });
        }
      } catch (err) {
        console.warn(
          `[Fed] Failed to fetch ${seriesId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    });

    await Promise.all(fetches);

    // If we got no data at all, return demo
    const hasAny =
      result.balanceSheet ||
      result.m2 ||
      result.fedFunds ||
      result.unemployment ||
      result.gdp ||
      result.cpi ||
      result.pce ||
      result.treasury10Y ||
      result.yieldSpread ||
      result.initialClaims ||
      result.industrialProduction ||
      result.consumerSentiment ||
      result.retailSales ||
      result.housingStarts;
    if (!hasAny) {
      return fedFallback();
    }

    backfillFromDemo(result);

    await setCache(cacheKey, result);
    // Persist a long-lived snapshot so a future FRED outage can serve real
    // (stale-flagged) data instead of synthetic demo numbers.
    await setCache(LASTGOOD_KEY, result, LASTGOOD_TTL_SECONDS);
    return result;
  } catch (error) {
    console.warn('[Fed] Failed to fetch data:', error instanceof Error ? error.message : error);
    return fedFallback();
  }
}

// ─── Internal Helpers ───

interface IndicatorValue {
  value: number;
  change?: number;
  date: string;
}

function assignIndicator(result: FedData, indicator: string, data: IndicatorValue): void {
  switch (indicator) {
    case 'balance_sheet':
      result.balanceSheet = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'm2':
      result.m2 = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'fed_funds':
      result.fedFunds = { value: data.value, date: data.date };
      break;
    case 'unemployment':
      result.unemployment = { value: data.value, date: data.date };
      break;
    case 'gdp':
      result.gdp = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'cpi':
      result.cpi = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'pce':
      result.pce = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'treasury_10y':
      result.treasury10Y = { value: data.value, date: data.date };
      break;
    case 'yield_spread':
      result.yieldSpread = { value: data.value, date: data.date };
      break;
    case 'initial_claims':
      result.initialClaims = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'industrial_production':
      result.industrialProduction = {
        value: data.value,
        change: data.change ?? 0,
        date: data.date,
      };
      break;
    case 'consumer_sentiment':
      result.consumerSentiment = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'retail_sales':
      result.retailSales = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
    case 'housing_starts':
      result.housingStarts = { value: data.value, change: data.change ?? 0, date: data.date };
      break;
  }
}

// ─── FRED Response Types ───

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations?: FredObservation[];
}

import { safeFetch } from '@/lib/security/safe-fetch';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const MASSIVE_BASE = 'https://api.massive.com/v2';
const MASSIVE_KEY = () => process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY;

const COINGECKO_KEY = () => process.env.COINGECKO_API_KEY;
const COINGECKO_PRO = () => process.env.COINGECKO_PRO === 'true';

function getCoingeckoBase(): string {
  return COINGECKO_PRO()
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3';
}

// ─── Types ───

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartDataResult {
  symbol: string;
  bars: OHLCVBar[];
  source: 'massive' | 'coingecko' | 'fallback';
  timeframe: string;
  interval: string;
}

// ─── Mapping helpers ───

const CRYPTO_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
};

const TIMEFRAME_DAYS: Record<string, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '2Y': 730,
};

interface MassiveTimespan {
  multiplier: number;
  timespan: string;
}

const INTERVAL_MAP: Record<string, MassiveTimespan> = {
  '1min': { multiplier: 1, timespan: 'minute' },
  '5min': { multiplier: 5, timespan: 'minute' },
  '15min': { multiplier: 15, timespan: 'minute' },
  '1hour': { multiplier: 1, timespan: 'hour' },
  '4hour': { multiplier: 4, timespan: 'hour' },
  '1day': { multiplier: 1, timespan: 'day' },
  '1week': { multiplier: 1, timespan: 'week' },
  '1month': { multiplier: 1, timespan: 'month' },
};

// ─── Public API ───

export async function fetchChartOHLCV(
  symbol: string,
  timeframe: string = '3M',
  interval: string = '1day',
): Promise<ChartDataResult> {
  const cacheKey = `chart:${symbol}:${timeframe}:${interval}`;
  const cached = await getCached<ChartDataResult>(cacheKey);
  if (cached) return cached;

  const coinId = CRYPTO_MAP[symbol.toUpperCase()];
  const result = coinId
    ? await fetchCoingeckoOHLC(symbol, coinId, timeframe, interval)
    : await fetchMassiveAggs(symbol, timeframe, interval);

  if (result.bars.length > 0) {
    await setCache(cacheKey, result);
  }

  return result;
}

// ─── Massive API (equities) ───

async function fetchMassiveAggs(
  symbol: string,
  timeframe: string,
  interval: string,
): Promise<ChartDataResult> {
  const fallback: ChartDataResult = {
    symbol,
    bars: [],
    source: 'fallback',
    timeframe,
    interval,
  };

  if (!MASSIVE_KEY()) {
    console.warn('[ChartOHLCV] No MASSIVE_API_KEY set — returning empty');
    return fallback;
  }

  if (!checkRateLimit('massive')) {
    console.warn('[ChartOHLCV] Massive rate limit hit');
    return fallback;
  }

  const mapped = INTERVAL_MAP[interval];
  if (!mapped) {
    console.warn(`[ChartOHLCV] Unknown interval: ${interval}`);
    return fallback;
  }

  const days = TIMEFRAME_DAYS[timeframe] ?? 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const fromStr = from.toISOString().split('T')[0]!;
  const toStr = to.toISOString().split('T')[0]!;

  const url = `${MASSIVE_BASE}/aggs/ticker/${encodeURIComponent(symbol)}/range/${mapped.multiplier}/${mapped.timespan}/${fromStr}/${toStr}?adjusted=true&sort=asc&apiKey=${MASSIVE_KEY()}`;

  try {
    const res = await safeFetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`[ChartOHLCV] Massive returned ${res.status} for ${symbol}`);
      return fallback;
    }

    const json = await res.json();
    const results = json.results as
      | Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>
      | undefined;

    if (!results || results.length === 0) return fallback;

    const bars: OHLCVBar[] = results.map((r) => ({
      time: new Date(r.t).toISOString().split('T')[0]!,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));

    return { symbol, bars, source: 'massive', timeframe, interval };
  } catch (err) {
    console.warn('[ChartOHLCV] Massive fetch error:', (err as Error).message);
    return fallback;
  }
}

// ─── CoinGecko OHLC (crypto) ───

async function fetchCoingeckoOHLC(
  symbol: string,
  coinId: string,
  timeframe: string,
  interval: string,
): Promise<ChartDataResult> {
  const fallback: ChartDataResult = {
    symbol,
    bars: [],
    source: 'fallback',
    timeframe,
    interval,
  };

  if (!checkRateLimit('coingecko')) {
    console.warn('[ChartOHLCV] CoinGecko rate limit hit');
    return fallback;
  }

  const days = TIMEFRAME_DAYS[timeframe] ?? 90;
  const baseUrl = getCoingeckoBase();
  const apiKey = COINGECKO_KEY();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers[COINGECKO_PRO() ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = apiKey;
  }

  const url = `${baseUrl}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

  try {
    const res = await safeFetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[ChartOHLCV] CoinGecko returned ${res.status}: ${body.slice(0, 200)}`);
      return fallback;
    }

    const data: number[][] = await res.json();
    if (!data || data.length === 0) return fallback;

    // CoinGecko returns [[timestamp, open, high, low, close], ...]
    // Deduplicate by timestamp
    const seen = new Set<number>();
    const bars: OHLCVBar[] = [];

    for (const entry of data) {
      const ts = entry[0];
      if (ts == null || seen.has(ts)) continue;
      seen.add(ts);

      bars.push({
        time: new Date(ts).toISOString().split('T')[0]!,
        open: entry[1] ?? 0,
        high: entry[2] ?? 0,
        low: entry[3] ?? 0,
        close: entry[4] ?? 0,
        volume: 0, // CoinGecko OHLC endpoint doesn't provide volume
      });
    }

    return { symbol, bars, source: 'coingecko', timeframe, interval };
  } catch (err) {
    console.warn('[ChartOHLCV] CoinGecko fetch error:', (err as Error).message);
    return fallback;
  }
}

import { safeFetch } from '@/lib/security/safe-fetch';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const MASSIVE_BASE = 'https://api.massive.com/v2';
const API_KEY = () => process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY;

export interface MarketSnapshot {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  previousClose: number;
  timestamp: string;
}

function safeTimestamp(value: unknown): string {
  if (value == null) return new Date().toISOString();
  const d = new Date(value as number);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const SYMBOL_NAMES: Record<string, string> = {
  SPY: 'S&P 500 ETF',
  QQQ: 'Nasdaq 100 ETF',
  DIA: 'Dow Jones ETF',
  IWM: 'Russell 2000 ETF',
  XLK: 'Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Healthcare',
  XLY: 'Consumer Disc.',
  XLI: 'Industrials',
  XLP: 'Consumer Staples',
  XLU: 'Utilities',
  XLB: 'Materials',
  XLRE: 'Real Estate',
  XLC: 'Communications',
  SMH: 'Semiconductors',
  VNO: 'Vornado Realty',
  SLG: 'SL Green Realty',
  BXP: 'BXP Inc',
  EQR: 'Equity Residential',
  AVB: 'AvalonBay',
  MAA: 'Mid-America Apt',
  INVH: 'Invitation Homes',
  AMH: 'American Homes 4 Rent',
  PLD: 'Prologis',
  DLR: 'Digital Realty',
  SPG: 'Simon Property',
  O: 'Realty Income',
  GLD: 'Gold',
  SLV: 'Silver',
  USO: 'Oil',
  UNG: 'Natural Gas',
  VIXY: 'VIX Short-Term',
};

export async function fetchIndices(): Promise<MarketSnapshot[]> {
  const symbols = ['SPY', 'QQQ', 'DIA', 'IWM'];
  return fetchQuotes(symbols);
}

export async function fetchSectors(): Promise<MarketSnapshot[]> {
  const symbols = [
    'XLK',
    'XLF',
    'XLE',
    'XLV',
    'XLY',
    'XLI',
    'XLP',
    'XLU',
    'XLB',
    'XLRE',
    'XLC',
    'SMH',
  ];
  return fetchQuotes(symbols);
}

export async function fetchCREReits(): Promise<MarketSnapshot[]> {
  const symbols = [
    'VNO',
    'SLG',
    'BXP',
    'EQR',
    'AVB',
    'MAA',
    'INVH',
    'AMH',
    'PLD',
    'DLR',
    'SPG',
    'O',
  ];
  return fetchQuotes(symbols);
}

export async function fetchCommodities(): Promise<MarketSnapshot[]> {
  const symbols = ['GLD', 'SLV', 'USO', 'UNG', 'VIXY'];
  return fetchQuotes(symbols);
}

export async function fetchQuotes(symbols: string[]): Promise<MarketSnapshot[]> {
  const cacheKey = `markets:${symbols.sort().join(',')}`;
  const cached = await getCached<MarketSnapshot[]>(cacheKey);
  if (cached) return cached;

  if (!API_KEY()) {
    console.warn('[Markets] No MASSIVE_API_KEY or POLYGON_API_KEY set — returning fallback');
    return symbols.map((s) => createFallback(s));
  }
  if (!checkRateLimit('massive')) return symbols.map((s) => createFallback(s));

  try {
    // Try intraday snapshot first (real-time during market hours)
    let results = await fetchSnapshot(symbols);

    // If snapshot returns all-zero prices (after hours), fall back to previous day close
    const hasRealData = results.some((r) => r.price > 0);
    if (!hasRealData) {
      results = await fetchPrevDay(symbols);
    }

    // Don't cache all-zero results — next request should retry the API
    const worthCaching = results.some((r) => r.price > 0);
    if (worthCaching) {
      await setCache(cacheKey, results);
    }
    return results;
  } catch (err) {
    console.warn('[Markets] fetchQuotes error:', (err as Error).message);
    return symbols.map((s) => createFallback(s));
  }
}

async function fetchSnapshot(symbols: string[]): Promise<MarketSnapshot[]> {
  const tickers = symbols.join(',');
  const url = `${MASSIVE_BASE}/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${API_KEY()}`;

  const res = await safeFetch(url, { cache: 'no-store' });
  if (!res.ok) {
    console.warn(`[Markets] Snapshot returned ${res.status} from ${MASSIVE_BASE}`);
    return symbols.map((s) => createFallback(s));
  }

  const json = await res.json();
  const tickerData = json.tickers as
    | Array<{
        ticker: string;
        todaysChange?: number;
        todaysChangePerc?: number;
        updated?: number;
        day?: { o: number; h: number; l: number; c: number; v: number };
        lastTrade?: { p: number; s: number; t: number };
        prevDay?: { o: number; h: number; l: number; c: number; v: number };
      }>
    | undefined;

  return symbols.map((sym) => {
    const t = tickerData?.find((d) => d.ticker === sym);
    if (!t) return createFallback(sym);

    const price = t.lastTrade?.p ?? t.day?.c ?? 0;
    const changePct = t.todaysChangePerc ?? 0;
    const volume = t.day?.v ?? 0;

    return {
      symbol: sym,
      name: SYMBOL_NAMES[sym] ?? sym,
      price,
      change: t.todaysChange ?? 0,
      changePct,
      volume,
      previousClose: t.prevDay?.c ?? 0,
      timestamp: safeTimestamp(t.updated),
    };
  });
}

async function fetchPrevDay(symbols: string[]): Promise<MarketSnapshot[]> {
  const results = await Promise.all(
    symbols.map(async (sym) => {
      try {
        const url = `${MASSIVE_BASE}/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${API_KEY()}`;
        const res = await safeFetch(url, { cache: 'no-store' });
        if (!res.ok) {
          console.warn(`[Markets] PrevDay for ${sym} returned ${res.status}`);
          return createFallback(sym);
        }

        const json = await res.json();
        const result = (
          json.results as
            | Array<{
                o: number;
                h: number;
                l: number;
                c: number;
                v: number;
                t: number;
              }>
            | undefined
        )?.[0];

        if (!result) return createFallback(sym);

        return {
          symbol: sym,
          name: SYMBOL_NAMES[sym] ?? sym,
          price: result.c,
          change: result.c - result.o,
          changePct: result.o > 0 ? ((result.c - result.o) / result.o) * 100 : 0,
          volume: result.v,
          previousClose: result.o,
          timestamp: safeTimestamp(result.t),
        };
      } catch {
        return createFallback(sym);
      }
    }),
  );
  return results;
}

function createFallback(symbol: string): MarketSnapshot {
  return {
    symbol,
    name: SYMBOL_NAMES[symbol] ?? symbol,
    price: 0,
    change: 0,
    changePct: 0,
    volume: 0,
    previousClose: 0,
    timestamp: new Date().toISOString(),
  };
}

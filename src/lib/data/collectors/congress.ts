import { safeFetch } from '@/lib/security/safe-fetch';
import type { CongressTrade } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const QUIVER_BASE = 'https://api.quiverquant.com/beta/live';
const API_KEY = () => process.env.QUIVER_API_KEY;

// ─── Fallback Demo Data ───

const DEMO_TRADES: CongressTrade[] = [
  {
    id: 'demo-congress-1',
    member: 'Nancy Pelosi',
    party: 'D',
    chamber: 'House',
    symbol: 'NVDA',
    transactionType: 'Purchase',
    amount: '$1,000,001 - $5,000,000',
    filedDate: '2026-01-15',
    url: 'https://www.quiverquant.com/congresstrading/',
  },
  {
    id: 'demo-congress-2',
    member: 'Dan Crenshaw',
    party: 'R',
    chamber: 'House',
    symbol: 'MSFT',
    transactionType: 'Purchase',
    amount: '$15,001 - $50,000',
    filedDate: '2026-01-14',
    url: 'https://www.quiverquant.com/congresstrading/',
  },
  {
    id: 'demo-congress-3',
    member: 'Tommy Tuberville',
    party: 'R',
    chamber: 'Senate',
    symbol: 'AAPL',
    transactionType: 'Sale (Partial)',
    amount: '$100,001 - $250,000',
    filedDate: '2026-01-12',
    url: 'https://www.quiverquant.com/congresstrading/',
  },
  {
    id: 'demo-congress-4',
    member: 'Mark Kelly',
    party: 'D',
    chamber: 'Senate',
    symbol: 'TSLA',
    transactionType: 'Purchase',
    amount: '$15,001 - $50,000',
    filedDate: '2026-01-10',
    url: 'https://www.quiverquant.com/congresstrading/',
  },
  {
    id: 'demo-congress-5',
    member: 'Josh Gottheimer',
    party: 'D',
    chamber: 'House',
    symbol: 'GOOGL',
    transactionType: 'Sale (Full)',
    amount: '$50,001 - $100,000',
    filedDate: '2026-01-09',
    url: 'https://www.quiverquant.com/congresstrading/',
  },
  {
    id: 'demo-congress-6',
    member: 'Markwayne Mullin',
    party: 'R',
    chamber: 'Senate',
    symbol: 'META',
    transactionType: 'Purchase',
    amount: '$1,001 - $15,000',
    filedDate: '2026-01-08',
    url: 'https://www.quiverquant.com/congresstrading/',
  },
];

// ─── Public API ───

export interface CongressTradeParams {
  member?: string;
  symbol?: string;
  days?: number;
}

/**
 * Fetch congressional stock trades from Quiver Quantitative.
 * Falls back to demo data when the API key is unavailable.
 */
export async function fetchCongressTrades(params?: CongressTradeParams): Promise<CongressTrade[]> {
  const cacheKey = 'congress:trades';
  const cached = await getCached<CongressTrade[]>(cacheKey);
  if (cached) return filterTrades(cached, params);

  const apiKey = API_KEY();
  if (!apiKey) {
    return filterTrades(DEMO_TRADES, params);
  }

  if (!checkRateLimit('quiver')) {
    return filterTrades(DEMO_TRADES, params);
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // Fetch from both House and Senate endpoints in parallel
    const [houseRes, senateRes] = await Promise.all([
      safeFetch(`${QUIVER_BASE}/housetrading`, { headers, next: { revalidate: 300 } }),
      safeFetch(`${QUIVER_BASE}/senatetrading`, { headers, next: { revalidate: 300 } }),
    ]);

    const trades: CongressTrade[] = [];

    if (houseRes.ok) {
      const houseData: QuiverTrade[] = await houseRes.json();
      trades.push(...houseData.map((t, i) => normalizeQuiverTrade(t, 'House', i)));
    } else {
      console.warn(`[Congress] House trading API returned ${houseRes.status}`);
    }

    if (senateRes.ok) {
      const senateData: QuiverTrade[] = await senateRes.json();
      trades.push(...senateData.map((t, i) => normalizeQuiverTrade(t, 'Senate', i)));
    } else {
      console.warn(`[Congress] Senate trading API returned ${senateRes.status}`);
    }

    if (trades.length === 0) {
      return filterTrades(DEMO_TRADES, params);
    }

    // Sort by filed date descending
    trades.sort((a, b) => new Date(b.filedDate).getTime() - new Date(a.filedDate).getTime());

    await setCache(cacheKey, trades);
    return filterTrades(trades, params);
  } catch (error) {
    console.warn(
      '[Congress] Failed to fetch trades:',
      error instanceof Error ? error.message : error,
    );
    return filterTrades(DEMO_TRADES, params);
  }
}

// ─── Internal Helpers ───

function normalizeQuiverTrade(
  raw: QuiverTrade,
  chamber: 'House' | 'Senate',
  index: number,
): CongressTrade {
  return {
    id: `congress-${chamber.toLowerCase()}-${raw.ReportDate ?? ''}-${index}`,
    member: raw.Representative ?? raw.Senator ?? 'Unknown',
    party: normalizeParty(raw.Party),
    chamber,
    symbol: raw.Ticker ?? 'N/A',
    transactionType: normalizeTransactionType(raw.Transaction),
    amount: raw.Amount ?? raw.Range ?? 'Unknown',
    filedDate: raw.ReportDate ?? raw.TransactionDate ?? new Date().toISOString().split('T')[0]!,
    url: 'https://www.quiverquant.com/congresstrading/',
  };
}

function normalizeParty(party?: string): 'D' | 'R' | 'I' {
  if (!party) return 'I';
  const p = party.charAt(0).toUpperCase();
  if (p === 'D') return 'D';
  if (p === 'R') return 'R';
  return 'I';
}

function normalizeTransactionType(
  tx?: string,
): 'Purchase' | 'Sale' | 'Sale (Full)' | 'Sale (Partial)' {
  if (!tx) return 'Purchase';
  const lower = tx.toLowerCase();
  if (lower.includes('sale') && lower.includes('full')) return 'Sale (Full)';
  if (lower.includes('sale') && lower.includes('partial')) return 'Sale (Partial)';
  if (lower.includes('sale')) return 'Sale';
  return 'Purchase';
}

function filterTrades(trades: CongressTrade[], params?: CongressTradeParams): CongressTrade[] {
  if (!params) return trades;

  let filtered = trades;

  if (params.member) {
    const memberLower = params.member.toLowerCase();
    filtered = filtered.filter((t) => t.member.toLowerCase().includes(memberLower));
  }

  if (params.symbol) {
    const symbolUpper = params.symbol.toUpperCase();
    filtered = filtered.filter((t) => t.symbol.toUpperCase() === symbolUpper);
  }

  if (params.days) {
    const cutoff = Date.now() - params.days * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((t) => new Date(t.filedDate).getTime() >= cutoff);
  }

  return filtered;
}

// ─── Quiver API Response Types ───

interface QuiverTrade {
  Representative?: string;
  Senator?: string;
  Party?: string;
  Ticker?: string;
  Transaction?: string;
  Amount?: string;
  Range?: string;
  ReportDate?: string;
  TransactionDate?: string;
}

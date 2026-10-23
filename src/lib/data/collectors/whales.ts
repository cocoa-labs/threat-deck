import { demoData } from '@/lib/data/fallback';
import { safeFetch } from '@/lib/security/safe-fetch';
import type { WhaleTransaction } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const WHALE_BASE = 'https://api.whale-alert.io/v1/transactions';
const API_KEY = () => process.env.WHALE_ALERT_API_KEY;

// ─── Fallback Demo Data ───

const DEMO_WHALES: WhaleTransaction[] = [
  {
    id: 'demo-whale-1',
    blockchain: 'bitcoin',
    symbol: 'BTC',
    amount: 500,
    amountUsd: 48_625_000,
    from: 'unknown',
    to: 'binance',
    timestamp: '2026-02-06T14:30:00Z',
  },
  {
    id: 'demo-whale-2',
    blockchain: 'ethereum',
    symbol: 'ETH',
    amount: 25_000,
    amountUsd: 85_500_000,
    from: 'unknown',
    to: 'coinbase',
    timestamp: '2026-02-06T13:15:00Z',
  },
  {
    id: 'demo-whale-3',
    blockchain: 'ethereum',
    symbol: 'USDT',
    amount: 150_000_000,
    amountUsd: 150_000_000,
    from: 'tether_treasury',
    to: 'bitfinex',
    timestamp: '2026-02-06T12:00:00Z',
  },
  {
    id: 'demo-whale-4',
    blockchain: 'bitcoin',
    symbol: 'BTC',
    amount: 1_200,
    amountUsd: 116_700_000,
    from: 'coinbase',
    to: 'unknown',
    timestamp: '2026-02-06T10:45:00Z',
  },
  {
    id: 'demo-whale-5',
    blockchain: 'ripple',
    symbol: 'XRP',
    amount: 80_000_000,
    amountUsd: 198_400_000,
    from: 'unknown',
    to: 'bitstamp',
    timestamp: '2026-02-06T09:30:00Z',
  },
];

// ─── Public API ───

export interface WhaleParams {
  min_value?: number;
  blockchain?: string;
}

/**
 * Fetch large cryptocurrency transactions from Whale Alert.
 * Falls back to demo data when the API key is unavailable.
 */
export async function fetchWhaleTransactions(params?: WhaleParams): Promise<WhaleTransaction[]> {
  const cacheKey = 'whales:transactions';
  const cached = await getCached<WhaleTransaction[]>(cacheKey);
  if (cached) return filterWhales(cached, params);

  const apiKey = API_KEY();
  if (!apiKey) {
    return filterWhales(demoData(DEMO_WHALES), params);
  }

  if (!checkRateLimit('whale_alert')) {
    return filterWhales(demoData(DEMO_WHALES), params);
  }

  try {
    const minValue = params?.min_value ?? 500_000;
    // Look back 1 hour from now
    const start = Math.floor((Date.now() - 3600_000) / 1000);

    let url = `${WHALE_BASE}?api_key=${apiKey}&min_value=${minValue}&start=${start}`;
    if (params?.blockchain) {
      url += `&blockchain=${params.blockchain}`;
    }

    const res = await safeFetch(url, { next: { revalidate: 300 } });

    if (!res.ok) {
      console.warn(`[Whales] Whale Alert API returned ${res.status}`);
      return filterWhales(demoData(DEMO_WHALES), params);
    }

    const data: WhaleAlertResponse = await res.json();

    if (!data.transactions || data.transactions.length === 0) {
      return filterWhales(demoData(DEMO_WHALES), params);
    }

    const transactions: WhaleTransaction[] = data.transactions.map((tx) => {
      const chain = tx.blockchain ?? 'unknown';
      const hash = tx.hash;
      return {
        id: tx.id ?? `whale-${hash ?? Date.now()}`,
        blockchain: chain,
        symbol: tx.symbol ?? 'UNKNOWN',
        amount: tx.amount ?? 0,
        amountUsd: tx.amount_usd ?? 0,
        from: formatOwner(tx.from),
        to: formatOwner(tx.to),
        timestamp: tx.timestamp
          ? new Date(tx.timestamp * 1000).toISOString()
          : new Date().toISOString(),
        hash,
        url: hash ? getExplorerUrl(chain, hash) : undefined,
      };
    });

    // Sort by USD value descending
    transactions.sort((a, b) => b.amountUsd - a.amountUsd);

    await setCache(cacheKey, transactions);
    return transactions;
  } catch (error) {
    console.warn(
      '[Whales] Failed to fetch transactions:',
      error instanceof Error ? error.message : error,
    );
    return filterWhales(demoData(DEMO_WHALES), params);
  }
}

// ─── Internal Helpers ───

const EXPLORER_MAP: Record<string, string> = {
  bitcoin: 'https://mempool.space/tx/',
  ethereum: 'https://etherscan.io/tx/',
  solana: 'https://solscan.io/tx/',
  tron: 'https://tronscan.org/#/transaction/',
  ripple: 'https://xrpscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
  avalanche: 'https://snowtrace.io/tx/',
  cardano: 'https://cardanoscan.io/transaction/',
};

function getExplorerUrl(blockchain: string, hash: string): string | undefined {
  const base = EXPLORER_MAP[blockchain.toLowerCase()];
  return base ? `${base}${hash}` : undefined;
}

function formatOwner(owner?: WhaleAlertOwner): string {
  if (!owner) return 'unknown';
  if (owner.owner_type === 'exchange' && owner.owner) return owner.owner;
  if (owner.owner) return owner.owner;
  return owner.owner_type ?? 'unknown';
}

function filterWhales(txs: WhaleTransaction[], params?: WhaleParams): WhaleTransaction[] {
  if (!params) return txs;

  let filtered = txs;

  if (params.min_value) {
    filtered = filtered.filter((tx) => tx.amountUsd >= (params.min_value ?? 0));
  }

  if (params.blockchain) {
    const chain = params.blockchain.toLowerCase();
    filtered = filtered.filter((tx) => tx.blockchain.toLowerCase() === chain);
  }

  return filtered;
}

// ─── Whale Alert Response Types ───

interface WhaleAlertOwner {
  address?: string;
  owner?: string;
  owner_type?: string;
}

interface WhaleAlertTransaction {
  id?: string;
  hash?: string;
  blockchain?: string;
  symbol?: string;
  amount?: number;
  amount_usd?: number;
  from?: WhaleAlertOwner;
  to?: WhaleAlertOwner;
  timestamp?: number;
}

interface WhaleAlertResponse {
  result?: string;
  count?: number;
  transactions?: WhaleAlertTransaction[];
}

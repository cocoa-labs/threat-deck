// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Whale Alert Fast Poller
// Server-side polling every 6s (10 req/min free tier max)
// Reduces whale transaction latency from 300s to ~6s
// ═══════════════════════════════════════════════

import { setCache } from '@/lib/data/rate-limiter';
import type { WhaleTransaction } from '@/lib/types';
import { wsServer } from '@/lib/ws/server';
import type { FeedConnector } from './base-connector';

// ─── Configuration ───

const WHALE_BASE = 'https://api.whale-alert.io/v1/transactions';
const API_KEY = () => process.env.WHALE_ALERT_API_KEY;
const POLL_INTERVAL_MS = 6_000; // 6 seconds = 10 req/min
const MIN_VALUE_USD = 500_000;
const LOOKBACK_SECONDS = 60; // Look back 1 minute each poll

// ─── Explorer URL Map ───

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

// ─── Types ───

interface WhaleAlertOwner {
  address?: string;
  owner?: string;
  owner_type?: string;
}

interface WhaleAlertTx {
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
  transactions?: WhaleAlertTx[];
}

// ─── Connector ───

class WhalePoller implements FeedConnector {
  readonly name = 'Whale Alert';

  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private seenIds = new Set<string>();
  private lastPollTimestamp = 0;

  async start(): Promise<void> {
    const apiKey = API_KEY();
    if (!apiKey) {
      console.log('[Whale Alert] No API key set, skipping poller');
      return;
    }

    this.active = true;
    this.lastPollTimestamp = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

    // Initial fetch
    await this.poll();

    // Start interval
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);

    console.log(`[Whale Alert] Polling every ${POLL_INTERVAL_MS / 1000}s`);
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isConnected(): boolean {
    return this.active;
  }

  private async poll(): Promise<void> {
    const apiKey = API_KEY();
    if (!apiKey) return;

    try {
      const start = this.lastPollTimestamp;
      const url = `${WHALE_BASE}?api_key=${apiKey}&min_value=${MIN_VALUE_USD}&start=${start}`;

      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 429) {
          console.warn('[Whale Alert] Rate limited, will retry next interval');
        }
        return;
      }

      const data: WhaleAlertResponse = await res.json();
      const txs = data.transactions ?? [];

      // Update last poll timestamp for next iteration
      this.lastPollTimestamp = Math.floor(Date.now() / 1000) - 10; // 10s overlap for safety

      // Filter to new transactions only
      const newTxs: WhaleTransaction[] = [];

      for (const tx of txs) {
        const txId = tx.id ?? tx.hash ?? '';
        if (!txId || this.seenIds.has(txId)) continue;

        this.seenIds.add(txId);
        const chain = tx.blockchain ?? 'unknown';
        const hash = tx.hash;

        newTxs.push({
          id: txId,
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
        });
      }

      if (newTxs.length > 0) {
        // Sort by USD value descending
        newTxs.sort((a, b) => b.amountUsd - a.amountUsd);

        // Broadcast new transactions
        wsServer.broadcast('whales', 'new_transactions', { data: newTxs });

        // Update cache with all known transactions
        void setCache('whales:transactions', newTxs, 300);
      }

      // Prune seen IDs set to prevent unbounded growth (keep last 1000)
      if (this.seenIds.size > 1000) {
        const arr = Array.from(this.seenIds);
        this.seenIds = new Set(arr.slice(-500));
      }
    } catch (err) {
      console.warn('[Whale Alert] Poll failed:', (err as Error).message);
    }
  }
}

function formatOwner(owner?: WhaleAlertOwner): string {
  if (!owner) return 'unknown';
  if (owner.owner_type === 'exchange' && owner.owner) return owner.owner;
  if (owner.owner) return owner.owner;
  return owner.owner_type ?? 'unknown';
}

function getExplorerUrl(blockchain: string, hash: string): string | undefined {
  const base = EXPLORER_MAP[blockchain.toLowerCase()];
  return base ? `${base}${hash}` : undefined;
}

export const whalePoller = new WhalePoller();

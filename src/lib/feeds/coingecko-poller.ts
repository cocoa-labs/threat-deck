// ═══════════════════════════════════════════════
// KLAMMER MONITOR - CoinGecko Server-Side Poller
// 30s polling for full crypto data (market cap, sparklines, rankings)
// Binance WS overwrites prices for top 5 between polls
// ═══════════════════════════════════════════════

import { fetchCryptoPrices } from '@/lib/data/collectors/crypto';
import { wsServer } from '@/lib/ws/server';
import type { FeedConnector } from './base-connector';

// ─── Configuration ───

const POLL_INTERVAL_MS = 30_000; // 30 seconds (was 60s via client polling)

// ─── Connector ───

class CoinGeckoPoller implements FeedConnector {
  readonly name = 'CoinGecko';

  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;

    // Initial fetch
    await this.poll();

    // Start interval
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);

    console.log(`[CoinGecko] Polling every ${POLL_INTERVAL_MS / 1000}s`);
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
    try {
      const prices = await fetchCryptoPrices(20);

      if (prices.length > 0) {
        // Broadcast full crypto data to all WS clients
        wsServer.broadcast('crypto', 'full_update', { data: prices });
      }
    } catch (err) {
      console.warn('[CoinGecko] Poll failed:', (err as Error).message);
    }
  }
}

export const coingeckoPoller = new CoinGeckoPoller();

// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Feed Manager
// Registry that starts/stops all feed connectors
// ═══════════════════════════════════════════════

import type { FeedConnector } from './base-connector';

class FeedManager {
  private connectors: FeedConnector[] = [];
  private running = false;

  register(connector: FeedConnector): void {
    this.connectors.push(connector);
  }

  async startAll(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[FeedManager] Starting ${this.connectors.length} feed connectors...`);

    const results = await Promise.allSettled(
      this.connectors.map(async (c) => {
        try {
          await c.start();
          console.log(`[FeedManager] ${c.name} started`);
        } catch (err) {
          console.error(`[FeedManager] ${c.name} failed to start:`, (err as Error).message);
        }
      }),
    );

    const started = results.filter((r) => r.status === 'fulfilled').length;
    console.log(`[FeedManager] ${started}/${this.connectors.length} connectors running`);
  }

  async stopAll(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.log('[FeedManager] Stopping all connectors...');

    await Promise.allSettled(
      this.connectors.map(async (c) => {
        try {
          await c.stop();
          console.log(`[FeedManager] ${c.name} stopped`);
        } catch (err) {
          console.error(`[FeedManager] ${c.name} stop error:`, (err as Error).message);
        }
      }),
    );
  }

  getStatus(): Array<{ name: string; connected: boolean }> {
    return this.connectors.map((c) => ({
      name: c.name,
      connected: c.isConnected(),
    }));
  }
}

// ─── Singleton ───

export const feedManager = new FeedManager();

// ─── Register all connectors ───
// Dynamic imports so server.ts can tree-shake if needed

export async function registerAllFeeds(): Promise<void> {
  try {
    const { massiveConnector } = await import('./massive-connector');
    feedManager.register(massiveConnector);
  } catch {
    /* Massive connector not available */
  }

  try {
    const { binanceConnector } = await import('./binance-connector');
    feedManager.register(binanceConnector);
  } catch {
    /* Binance connector not available */
  }

  try {
    const { coingeckoPoller } = await import('./coingecko-poller');
    feedManager.register(coingeckoPoller);
  } catch {
    /* CoinGecko poller not available */
  }

  try {
    const { polymarketConnector } = await import('./polymarket-connector');
    feedManager.register(polymarketConnector);
  } catch {
    /* Polymarket connector not available */
  }

  try {
    const { whalePoller } = await import('./whale-poller');
    feedManager.register(whalePoller);
  } catch {
    /* Whale poller not available */
  }
}

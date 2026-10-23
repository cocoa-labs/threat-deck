// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Polymarket WebSocket Connector
// Real-time prediction market odds updates
// ═══════════════════════════════════════════════

import WebSocket from 'ws';
import { wsServer } from '@/lib/ws/server';
import type { FeedConnector } from './base-connector';

// ─── Configuration ───

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const REST_URL = 'https://clob.polymarket.com/markets';
const MARKET_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // Re-fetch market list every 5 min
const MAX_SUBSCRIPTIONS = 50; // Limit simultaneous market subscriptions

// ─── Types ───

interface PolymarketWSMessage {
  event_type?: string;
  market?: string;
  asset_id?: string;
  price?: string | number;
  outcome?: string;
  timestamp?: number;
}

interface PolymarketMarketInfo {
  condition_id: string;
  question: string;
  category?: string;
  volume?: number;
}

// ─── Connector ───

class PolymarketConnector implements FeedConnector {
  readonly name = 'Polymarket';

  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1_000;
  private shouldRun = false;
  private subscribedMarkets = new Map<string, PolymarketMarketInfo>();

  async start(): Promise<void> {
    this.shouldRun = true;

    // Fetch initial market list
    await this.fetchMarkets();

    // Connect WebSocket
    this.connect();

    // Schedule periodic market list refresh
    this.refreshTimer = setInterval(() => {
      void this.fetchMarkets();
    }, MARKET_REFRESH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.cleanup();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private connect(): void {
    if (!this.shouldRun) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectDelay = 1_000;
        console.log('[Polymarket] Connected - subscribing to markets');
        this.subscribeToMarkets();
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as PolymarketWSMessage;
          this.handleMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.warn('[Polymarket] WebSocket error:', err.message);
      });
    } catch (err) {
      console.error('[Polymarket] Connection failed:', (err as Error).message);
      this.scheduleReconnect();
    }
  }

  private async fetchMarkets(): Promise<void> {
    try {
      const res = await fetch(`${REST_URL}?limit=${MAX_SUBSCRIPTIONS}&active=true&closed=false`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        console.warn(`[Polymarket] Market fetch returned ${res.status}`);
        return;
      }

      const data = (await res.json()) as unknown;
      const rawMarkets = Array.isArray(data)
        ? (data as PolymarketMarketInfo[])
        : (((data as Record<string, unknown>).data ??
            (data as Record<string, unknown>).markets ??
            []) as PolymarketMarketInfo[]);

      this.subscribedMarkets.clear();
      for (const m of rawMarkets.slice(0, MAX_SUBSCRIPTIONS)) {
        const id = m.condition_id;
        if (id) {
          this.subscribedMarkets.set(id, m);
        }
      }

      console.log(`[Polymarket] Tracking ${this.subscribedMarkets.size} markets`);

      // Re-subscribe if connected
      if (this.connected) {
        this.subscribeToMarkets();
      }
    } catch (err) {
      console.warn('[Polymarket] Failed to fetch markets:', (err as Error).message);
    }
  }

  private subscribeToMarkets(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const marketId of this.subscribedMarkets.keys()) {
      this.ws.send(
        JSON.stringify({
          type: 'subscribe',
          market: marketId,
        }),
      );
    }
  }

  private handleMessage(msg: PolymarketWSMessage): void {
    const eventType = msg.event_type;
    if (!eventType) return;

    if (eventType === 'price_change' || eventType === 'last_trade_price') {
      const marketId = msg.market ?? msg.asset_id;
      if (!marketId) return;

      const marketInfo = this.subscribedMarkets.get(marketId);
      const price = typeof msg.price === 'string' ? parseFloat(msg.price) : msg.price;

      if (price == null || Number.isNaN(price)) return;

      const update = {
        id: marketId,
        question: marketInfo?.question ?? marketId,
        category: marketInfo?.category ?? 'General',
        probability: price,
        outcome: msg.outcome,
        timestamp: msg.timestamp ?? Date.now(),
      };

      wsServer.broadcast('polymarket', 'odds_update', { data: update });
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;

    this.reconnectTimer = setTimeout(() => {
      console.log(`[Polymarket] Reconnecting (delay: ${this.reconnectDelay}ms)...`);
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Shutting down');
      }
      this.ws = null;
    }
    this.connected = false;
  }
}

export const polymarketConnector = new PolymarketConnector();

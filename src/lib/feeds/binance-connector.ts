// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Binance WebSocket Connector
// FREE, no auth required. Sub-second crypto prices.
// Uses Binance.US endpoint (US-compliant).
// Falls back to global endpoint via env override.
// ═══════════════════════════════════════════════

import WebSocket from 'ws';
import { setCache } from '@/lib/data/rate-limiter';
import { wsServer } from '@/lib/ws/server';
import type { FeedConnector } from './base-connector';

// ─── Configuration ───

// Top 5 coins tracked via Binance mini-ticker stream
const TRACKED_PAIRS = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt'];

// Map Binance pair symbols to CoinGecko IDs and display symbols
const SYMBOL_MAP: Record<string, { id: string; symbol: string; name: string }> = {
  btcusdt: { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
  ethusdt: { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
  solusdt: { id: 'solana', symbol: 'sol', name: 'Solana' },
  bnbusdt: { id: 'binancecoin', symbol: 'bnb', name: 'BNB' },
  xrpusdt: { id: 'ripple', symbol: 'xrp', name: 'XRP' },
};

// Binance.US WebSocket (US-compliant, no 451 errors)
// Override with BINANCE_WS_URL env var if you have global Binance access
const BINANCE_WS_BASE = process.env.BINANCE_WS_URL || 'wss://stream.binance.us:9443';
const WS_URL = `${BINANCE_WS_BASE}/ws/${TRACKED_PAIRS.map((p) => `${p}@miniTicker`).join('/')}`;

// Binance closes WS connections after 24h; reconnect at 23h
const RECONNECT_BEFORE_LIMIT_MS = 23 * 60 * 60 * 1000;

// ─── Mini-Ticker Message ───

interface BinanceMiniTicker {
  e: string; // Event type (24hrMiniTicker)
  s: string; // Symbol (BTCUSDT)
  c: string; // Close price
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Base asset volume
  q: string; // Quote asset volume
}

// ─── Connector ───

class BinanceConnector implements FeedConnector {
  readonly name = 'Binance';

  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private shouldRun = false;

  async start(): Promise<void> {
    this.shouldRun = true;
    this.connect();
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
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
        console.log(
          `[Binance] Connected to ${BINANCE_WS_BASE} - streaming real-time crypto prices`,
        );

        // Schedule reconnect before Binance 24h limit
        this.connectionTimer = setTimeout(() => {
          console.log('[Binance] Proactive reconnect (approaching 24h limit)');
          this.reconnect();
        }, RECONNECT_BEFORE_LIMIT_MS);
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as BinanceMiniTicker;
          this.handleTicker(msg);
        } catch {
          // Ignore malformed messages
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        if (err.message.includes('451')) {
          console.warn(
            '[Binance] HTTP 451 (geo-blocked). If using Binance.US and still blocked, set BINANCE_WS_URL env var to a reachable endpoint.',
          );
          this.shouldRun = false; // Stop retrying — won't resolve without config change
        } else {
          console.warn('[Binance] WebSocket error:', err.message);
        }
      });
    } catch (err) {
      console.error('[Binance] Connection failed:', (err as Error).message);
      this.scheduleReconnect();
    }
  }

  private handleTicker(msg: BinanceMiniTicker): void {
    const pair = msg.s?.toLowerCase();
    if (!pair) return;

    const meta = SYMBOL_MAP[pair];
    if (!meta) return;

    const price = parseFloat(msg.c);
    const open = parseFloat(msg.o);
    const change24h = open > 0 ? ((price - open) / open) * 100 : 0;

    const update = {
      id: meta.id,
      symbol: meta.symbol,
      name: meta.name,
      price,
      change24h,
      volume24h: parseFloat(msg.q) || 0,
    };

    // Broadcast to all WS clients subscribed to crypto channel
    wsServer.broadcast('crypto', 'price_update', { data: update });

    // Write-through to cache so REST fallback gets fresh data
    void setCache(`crypto:realtime:${meta.id}`, update, 30);
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;

    this.reconnectTimer = setTimeout(() => {
      console.log(`[Binance] Reconnecting (delay: ${this.reconnectDelay}ms)...`);
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  private reconnect(): void {
    this.cleanup();
    this.connect();
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
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

export const binanceConnector = new BinanceConnector();

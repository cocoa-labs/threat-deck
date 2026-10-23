// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Massive/Polygon WebSocket Connector
// Real-time market data via per-minute aggregates
// Requires paid Massive/Polygon plan ($29+/mo)
// ═══════════════════════════════════════════════

import WebSocket from 'ws';
import { setCache } from '@/lib/data/rate-limiter';
import { wsServer } from '@/lib/ws/server';
import type { FeedConnector } from './base-connector';

// ─── Configuration ───

const WS_URL = 'wss://delayed.polygon.io/stocks'; // Use wss://socket.polygon.io/stocks for real-time
const API_KEY = () => process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY;

// All tracked symbols (indices + sectors + commodities)
const TRACKED_SYMBOLS = [
  'SPY',
  'QQQ',
  'DIA',
  'IWM',
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
  'GLD',
  'SLV',
  'USO',
  'UNG',
  'VIXY',
];

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
  GLD: 'Gold',
  SLV: 'Silver',
  USO: 'Oil',
  UNG: 'Natural Gas',
  VIXY: 'VIX Short-Term',
};

const INDEX_SYMBOLS = new Set(['SPY', 'QQQ', 'DIA', 'IWM']);
const COMMODITY_SYMBOLS = new Set(['GLD', 'SLV', 'USO', 'UNG', 'VIXY']);

// ─── Polygon WS Message Types ───

interface PolygonAuthMessage {
  action: 'auth';
  params: string;
}

interface PolygonSubscribeMessage {
  action: 'subscribe';
  params: string;
}

interface PolygonAMMessage {
  ev: 'AM'; // Per-minute aggregate
  sym: string;
  v: number; // Volume
  o: number; // Open
  c: number; // Close
  h: number; // High
  l: number; // Low
  s: number; // Start timestamp
  e: number; // End timestamp
}

interface PolygonStatusMessage {
  ev: 'status';
  status: string;
  message: string;
}

type PolygonMessage = PolygonAMMessage | PolygonStatusMessage;

// ─── Connector ───

class MassiveConnector implements FeedConnector {
  readonly name = 'Massive/Polygon';

  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private shouldRun = false;
  private lastPrices = new Map<string, number>();

  async start(): Promise<void> {
    const apiKey = API_KEY();
    if (!apiKey) {
      console.log('[Massive] No API key set, skipping WebSocket connector');
      return;
    }

    this.shouldRun = true;
    this.connect();
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    this.cleanup();
  }

  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  private connect(): void {
    if (!this.shouldRun) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => {
        console.log('[Massive] WebSocket connected, authenticating...');
        // Polygon requires auth immediately after connection
        const authMsg: PolygonAuthMessage = {
          action: 'auth',
          params: API_KEY()!,
        };
        this.ws?.send(JSON.stringify(authMsg));
      });

      this.ws.on('message', (raw) => {
        try {
          const messages = JSON.parse(String(raw)) as PolygonMessage[];
          if (!Array.isArray(messages)) return;

          for (const msg of messages) {
            if (msg.ev === 'status') {
              this.handleStatus(msg);
            } else if (msg.ev === 'AM') {
              this.handleAggregate(msg);
            }
          }
        } catch {
          // Ignore malformed messages
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.authenticated = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.warn('[Massive] WebSocket error:', err.message);
      });
    } catch (err) {
      console.error('[Massive] Connection failed:', (err as Error).message);
      this.scheduleReconnect();
    }
  }

  private handleStatus(msg: PolygonStatusMessage): void {
    if (msg.status === 'auth_success') {
      this.connected = true;
      this.authenticated = true;
      this.reconnectDelay = 1_000;
      console.log('[Massive] Authenticated - subscribing to market data');

      // Subscribe to per-minute aggregates for all tracked symbols
      const subParams = TRACKED_SYMBOLS.map((s) => `AM.${s}`).join(',');
      const subMsg: PolygonSubscribeMessage = {
        action: 'subscribe',
        params: subParams,
      };
      this.ws?.send(JSON.stringify(subMsg));
    } else if (msg.status === 'auth_failed') {
      console.error('[Massive] Authentication failed:', msg.message);
      console.error('[Massive] WebSocket access may require a paid Polygon plan ($29+/mo)');
      this.shouldRun = false;
      this.cleanup();
    } else if (msg.status === 'success') {
      console.log('[Massive] Subscribed:', msg.message);
    }
  }

  private handleAggregate(msg: PolygonAMMessage): void {
    const symbol = msg.sym;
    if (!symbol || !TRACKED_SYMBOLS.includes(symbol)) return;

    const prevPrice = this.lastPrices.get(symbol) ?? msg.o;
    const changePct = prevPrice > 0 ? ((msg.c - prevPrice) / prevPrice) * 100 : 0;
    this.lastPrices.set(symbol, msg.c);

    const snapshot = {
      symbol,
      name: SYMBOL_NAMES[symbol] ?? symbol,
      price: msg.c,
      change: msg.c - prevPrice,
      changePct,
      volume: msg.v,
      previousClose: prevPrice,
      timestamp: new Date(msg.e).toISOString(),
    };

    // Determine channel type
    let type: string;
    if (INDEX_SYMBOLS.has(symbol)) {
      type = 'indices';
    } else if (COMMODITY_SYMBOLS.has(symbol)) {
      type = 'commodities';
    } else {
      type = 'sectors';
    }

    // Broadcast to WS clients
    wsServer.broadcast('markets', type, { [type]: [snapshot] });

    // Write-through to cache for REST fallback
    void setCache(`markets:ws:${symbol}`, snapshot, 120);
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;

    this.reconnectTimer = setTimeout(() => {
      console.log(`[Massive] Reconnecting (delay: ${this.reconnectDelay}ms)...`);
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
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
    this.authenticated = false;
  }
}

export const massiveConnector = new MassiveConnector();

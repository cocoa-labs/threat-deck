import { isEmailAllowed } from '@/lib/auth/allowlist';
import { isTrustedOrigin } from '@/lib/security/origin';
import { consumeWSTicket } from './tickets';
// ═══════════════════════════════════════════════
// THREAT DECK - WebSocket Server
// Channel-based pub/sub with heartbeat
// ═══════════════════════════════════════════════

import type { Server as HTTPServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

// ─── Types ───

export type WSChannel =
  | 'markets'
  | 'news'
  | 'crypto'
  | 'whales'
  | 'congress'
  | 'fed'
  | 'polymarket'
  | 'alerts'
  | 'agent'
  // ─── Cyber nudge channels (Phase 4.1) ───
  // Lightweight `{ type:'refresh' }` nudges; the client invalidates the
  // matching TanStack queries (see src/lib/ws/cyber-channels.ts). No payloads.
  | 'cves'
  | 'kev'
  | 'iocs'
  | 'breaches'
  | 'advisories';

export interface WSMessage {
  channel: WSChannel;
  type: string;
  data: unknown;
  timestamp: number;
}

interface TrackedClient {
  ws: WebSocket;
  channels: Set<WSChannel>;
  alive: boolean;
  connectedAt: number;
  email: string;
  messages: number;
  windowStart: number;
}

// ─── Server Class ───

const HEARTBEAT_INTERVAL_MS = 30_000;
const ALL_CHANNELS: WSChannel[] = [
  'markets',
  'news',
  'crypto',
  'whales',
  'congress',
  'fed',
  'polymarket',
  'alerts',
  'agent',
  // Cyber nudge channels (Phase 4.1) — kept in sync with client ALL_CHANNELS
  // and CYBER_CHANNELS in src/lib/ws/cyber-channels.ts. The subscribe handler
  // filters incoming subscriptions to this list, so these must be present for
  // clients to receive cyber refresh nudges.
  'cves',
  'kev',
  'iocs',
  'breaches',
  'advisories',
];

export class ThreatDeckWSServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, TrackedClient>();
  private pendingUpgrades = 0;
  private identities = new WeakMap<WebSocket, string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize the WebSocket server in noServer mode.
   * The HTTP server must manually route 'upgrade' events via handleUpgrade().
   * This prevents the ws library from destroying non-matching upgrade requests
   * (which breaks Next.js dev server HMR connections).
   */
  init(server: HTTPServer, path = '/ws'): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 8192,
      perMessageDeflate: false,
      handleProtocols: (protocols) => (protocols.has('threatdeck') ? 'threatdeck' : false),
    });

    // Manually handle upgrade events — only accept our path, pass others through
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      if (pathname !== path) return;
      const origin = request.headers.origin ?? null;
      const protocols = (request.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((p) => p.trim());
      const credential = protocols.find((p) => p.startsWith('auth.'))?.slice(5);
      if (
        !isTrustedOrigin(origin) ||
        !credential ||
        this.clients.size + this.pendingUpgrades >= 128
      ) {
        socket.destroy();
        return;
      }
      this.pendingUpgrades++;
      const timeout = setTimeout(() => socket.destroy(), 3000);
      void consumeWSTicket(credential, origin!)
        .then((email) => {
          if (
            !email ||
            socket.destroyed ||
            !this.wss ||
            [...this.clients.values()].filter((c) => c.email === email).length >= 8
          ) {
            socket.destroy();
            return;
          }
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.identities.set(ws, email);
            this.wss?.emit('connection', ws, request);
          });
        })
        .catch(() => socket.destroy())
        .finally(() => {
          clearTimeout(timeout);
          this.pendingUpgrades--;
        });
    });

    this.wss.on('connection', (ws) => {
      const email = this.identities.get(ws);
      if (!email) {
        ws.close(1008, 'Unauthorized');
        return;
      }
      const client: TrackedClient = {
        ws,
        channels: new Set(),
        alive: true,
        connectedAt: Date.now(),
        email,
        messages: 0,
        windowStart: Date.now(),
      };
      this.clients.set(ws, client);

      ws.on('pong', () => {
        client.alive = true;
      });

      ws.on('message', (raw) => {
        if (Date.now() - client.windowStart >= 60_000) {
          client.messages = 0;
          client.windowStart = Date.now();
        }
        if (++client.messages > 60) {
          ws.close(1008, 'Message limit');
          return;
        }
        try {
          const msg = JSON.parse(String(raw)) as {
            action?: string;
            channels?: string[];
          };
          if (
            !msg ||
            !Array.isArray(msg.channels) ||
            msg.channels.length > ALL_CHANNELS.length ||
            msg.channels.some(
              (c) => typeof c !== 'string' || !ALL_CHANNELS.includes(c as WSChannel),
            )
          ) {
            ws.close(1008, 'Invalid subscription');
            return;
          }
          this.handleClientMessage(client, msg);
        } catch {
          ws.close(1008, 'Invalid message');
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });

      // Send welcome message
      this.send(ws, {
        channel: 'agent',
        type: 'connected',
        data: { channels: ALL_CHANNELS },
        timestamp: Date.now(),
      });
    });

    this.startHeartbeat();
  }

  /**
   * Broadcast a message to all clients subscribed to the given channel.
   */
  broadcast(channel: WSChannel, type: string, data: unknown): void {
    const message: WSMessage = {
      channel,
      type,
      data,
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(message);

    for (const client of this.clients.values()) {
      if (!isEmailAllowed(client.email)) {
        client.ws.close(1008, 'Unauthorized');
        continue;
      }
      if (client.ws.bufferedAmount > 1024 * 1024) {
        client.ws.close(1008, 'Slow consumer');
        continue;
      }
      if (client.channels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  /**
   * Returns the number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Returns per-channel subscriber counts.
   */
  getChannelCounts(): Record<WSChannel, number> {
    const counts = Object.fromEntries(ALL_CHANNELS.map((c) => [c, 0])) as Record<WSChannel, number>;
    for (const client of this.clients.values()) {
      for (const ch of client.channels) {
        counts[ch]++;
      }
    }
    return counts;
  }

  /**
   * Gracefully shut down the WebSocket server.
   */
  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients.values()) {
      client.ws.close(1000, 'Server shutting down');
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }

  // ─── Private ───

  private handleClientMessage(
    client: TrackedClient,
    msg: { action?: string; channels?: string[] },
  ): void {
    switch (msg.action) {
      case 'subscribe': {
        const channels = (msg.channels ?? []).filter((c): c is WSChannel =>
          ALL_CHANNELS.includes(c as WSChannel),
        );
        for (const ch of channels) {
          client.channels.add(ch);
        }
        this.send(client.ws, {
          channel: 'agent',
          type: 'subscribed',
          data: { channels: [...client.channels] },
          timestamp: Date.now(),
        });
        break;
      }
      case 'unsubscribe': {
        const channels = (msg.channels ?? []).filter((c): c is WSChannel =>
          ALL_CHANNELS.includes(c as WSChannel),
        );
        for (const ch of channels) {
          client.channels.delete(ch);
        }
        this.send(client.ws, {
          channel: 'agent',
          type: 'unsubscribed',
          data: { channels: [...client.channels] },
          timestamp: Date.now(),
        });
        break;
      }
      default:
        break;
    }
  }

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [ws, client] of this.clients.entries()) {
        if (
          !client.alive ||
          !isEmailAllowed(client.email) ||
          Date.now() - client.connectedAt > 15 * 60_000
        ) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        client.alive = false;
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}

// ─── Singleton & Helpers ───

const globalForWS = globalThis as typeof globalThis & {
  _threatDeckWS?: ThreatDeckWSServer;
};

export const wsServer: ThreatDeckWSServer = globalForWS._threatDeckWS ?? new ThreatDeckWSServer();

if (process.env.NODE_ENV !== 'production') {
  globalForWS._threatDeckWS = wsServer;
}

/**
 * Convenience helper to broadcast to a channel without importing the singleton.
 * Usage: broadcast('markets', 'quote_update', { symbol: 'AAPL', price: 150 })
 */
export function broadcast(channel: WSChannel, type: string, data: unknown): void {
  wsServer.broadcast(channel, type, data);
}

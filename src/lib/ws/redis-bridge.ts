// ═══════════════════════════════════════════════
// THREAT DECK — Redis → WebSocket push bridge (Phase 4.2)
// ═══════════════════════════════════════════════
//
// The AEGIS ingest runs as a Vercel cron — a DIFFERENT process from the Fly
// WebSocket server in prod — so it can't call `wsServer.broadcast` directly.
// Instead it PUBLISHes a lightweight nudge to the `aegis:push` Redis channel
// (see `src/lib/aegis/ingest/index.ts` → `publishIngestNudges`).
//
// This module is the SUBSCRIBER half: it runs inside the WS-server process
// (Fly in prod; the root `server.ts` custom server under `npm run dev:full`
// locally), SUBSCRIBEs to `aegis:push`, and re-emits each valid nudge as a
// `wsServer.broadcast(channel, 'refresh', { count })`. Clients already react to
// that broadcast (Phase 4.1 `dispatchCyber` → invalidate matching query →
// refetch). Both halves talk to the same Redis (`REDIS_URL`), so pub/sub flows
// even when they are separate processes.
//
// YAGNI: the nudge carries only `{ channel, type:'refresh', count }` — no row
// payloads. The 5-minute client poll floor backstops any dropped message.

import { AEGIS_PUSH_CHANNEL } from '@/lib/aegis/ingest';
import { redisSub } from '@/lib/redis/client';
import { CYBER_CHANNELS, type CyberChannel } from './cyber-channels';
import type { WSChannel } from './server';
import { broadcast } from './server';

// `CyberChannel ⊂ WSChannel`, so `wsServer.broadcast` (which expects a
// `WSChannel`) is assignable to this slot — the validated channel is always a
// real WS channel by the time we call.
type BroadcastFn = (channel: WSChannel, type: string, data: unknown) => void;

function isCyberChannel(channel: unknown): channel is CyberChannel {
  return typeof channel === 'string' && (CYBER_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Pure, testable: parse a raw `aegis:push` message and broadcast it via the
 * supplied `broadcast` function. Silently ignores malformed JSON, non-object
 * payloads, unknown channels, and non-`refresh` types — a bad message must
 * never throw (it would crash the subscriber's `message` handler).
 *
 * On a valid nudge → `broadcast(channel, 'refresh', { count })`. `count` is
 * coerced to a finite number, defaulting to 0 when absent or non-numeric.
 */
export function handleAegisPushMessage(raw: string, broadcastFn: BroadcastFn): void {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return; // malformed JSON — ignore
  }

  if (typeof msg !== 'object' || msg === null) return;
  const { channel, type, count } = msg as { channel?: unknown; type?: unknown; count?: unknown };

  if (!isCyberChannel(channel)) return;
  if (type !== 'refresh') return;

  const safeCount = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  // `channel` is narrowed to `CyberChannel` (⊂ WSChannel) by `isCyberChannel`.
  broadcastFn(channel, 'refresh', { count: safeCount });
}

let started = false;

/**
 * Idempotent. Opens the dedicated subscriber connection, SUBSCRIBEs to
 * `aegis:push`, and wires each message to `wsServer.broadcast`.
 *
 * Uses the project's purpose-built `redisSub` client (a connection in
 * subscriber mode can't run normal commands, so pub/sub gets its own socket).
 * `connectRedis()` — called just before this in `server.ts` — already opens it;
 * `subscribe()` is safe to call once that connection is established. A Redis
 * hiccup logs and is left to ioredis's retry strategy — it never crashes the
 * WS-server process.
 */
export function startAegisPushBridge(): void {
  if (started) return;
  started = true;

  redisSub.on('message', (_channel: string, raw: string) => {
    handleAegisPushMessage(raw, broadcast);
  });

  redisSub
    .subscribe(AEGIS_PUSH_CHANNEL)
    .then(() => {
      console.log(
        `[redis-bridge] Subscribed to '${AEGIS_PUSH_CHANNEL}' — ingest nudges → WS broadcast`,
      );
    })
    .catch((err: Error) => {
      // Don't crash the server — ioredis will retry the connection per its
      // retryStrategy; resubscription happens automatically on reconnect.
      console.warn(`[redis-bridge] Failed to subscribe to '${AEGIS_PUSH_CHANNEL}':`, err.message);
    });
}

// ═══════════════════════════════════════════════
// COCOA AI THREAT DECK - Custom Node.js Server
// Wraps Next.js with WebSocket + Redis + Feeds
// ═══════════════════════════════════════════════

import { createServer } from 'node:http';
import next from 'next';
import { isCapabilityEnabled } from './src/lib/security/capabilities';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3002', 10);

async function main() {
  // Validate env first — this throws if required vars are missing or invalid,
  // surfacing misconfigurations at boot rather than as cryptic 500s later.
  // Dynamic import so the throw is caught by the main().catch handler below
  // and produces a single, clean fatal-error line in the boot log.
  const { envSafe } = await import('./src/lib/env.js');

  // Surface the (sanitized) effective config so deploy-time misconfigs are
  // obvious in the boot log. Secrets are masked by envSafe().
  console.log('[Server] Effective env (sanitized):');
  for (const [k, v] of Object.entries(envSafe())) {
    console.log(`[Server]   ${k}=${v === undefined ? '<unset>' : String(v)}`);
  }

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => {
    // Let Next parse the URL internally (avoids the deprecated node:url
    // `parse()`, DEP0169). The WebSocket upgrade is handled separately via
    // the server's `upgrade` event in wsServer.init().
    handle(req, res);
  });

  // Connect Redis
  try {
    const { connectRedis } = await import('./src/lib/redis/client.js');
    await connectRedis();
    console.log('[Server] Redis connected');
  } catch (err) {
    console.warn('[Server] Redis unavailable, continuing without it:', (err as Error).message);
  }

  // Attach WebSocket server
  try {
    const { wsServer } = await import('./src/lib/ws/server.js');
    wsServer.init(server, '/ws');
    console.log('[Server] WebSocket server attached at /ws');
  } catch (err) {
    console.error('[Server] Failed to attach WebSocket server:', (err as Error).message);
  }

  // Start the Redis → WS push bridge (Phase 4.2). SUBSCRIBEs to `aegis:push`
  // and re-broadcasts ingest nudges to clients. Runs here (dev:full + Fly), but
  // NOT under plain `next dev` / Vercel — those have no long-lived WS server.
  try {
    const { startAegisPushBridge } = await import('./src/lib/ws/redis-bridge.js');
    startAegisPushBridge();
    console.log('[Server] AEGIS push bridge started (aegis:push -> WS broadcast)');
  } catch (err) {
    console.warn('[Server] AEGIS push bridge not started:', (err as Error).message);
  }

  // Paid/autonomous background work requires an explicit opt-in.
  if (isCapabilityEnabled('automation')) try {
    const { registerAllFeeds, feedManager } = await import('./src/lib/feeds/manager.js');
    await registerAllFeeds();
    await feedManager.startAll();
    console.log('[Server] Feed connectors started');
  } catch (err) {
    console.warn('[Server] Feed connectors not available:', (err as Error).message);
  }

  // Storage cleanup is maintenance for explicit user deletions, not autonomous publishing.
  const { startAegisCollection } = await import('./src/lib/aegis/ingest/local-worker.js');
  const stopAegisCollection = startAegisCollection();
  const { retryAttachmentDeletions } = await import('./src/lib/agent/attachments/blob-cleanup.js');
  const cleanupTimer = setInterval(() => { void retryAttachmentDeletions().catch(() => console.warn('[Server] Attachment cleanup deferred; will retry')); }, 60_000);
  cleanupTimer.unref();
  server.listen(port, hostname, () => {
    console.log(`[Server] Cocoa AI Threat Deck ready at http://${hostname}:${port}`);
    console.log('[Server] WebSocket endpoint: /ws (use TLS at your reverse proxy)');
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Server] Shutting down...');
    clearInterval(cleanupTimer);
    stopAegisCollection();
    try {
      const { feedManager } = await import('./src/lib/feeds/manager.js');
      await feedManager.stopAll();
    } catch { /* ignore */ }
    try {
      const { wsServer } = await import('./src/lib/ws/server.js');
      wsServer.close();
    } catch { /* ignore */ }
    try {
      const { disconnectRedis } = await import('./src/lib/redis/client.js');
      await disconnectRedis();
    } catch { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});

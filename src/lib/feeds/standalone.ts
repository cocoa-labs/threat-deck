// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Standalone Feed Runner
// Run alongside `npm run dev` to populate Redis
// with real-time data from all feed connectors.
// Usage: npm run dev:feeds
// ═══════════════════════════════════════════════

async function main() {
  console.log('[Feeds] Starting standalone feed runner...');

  // Connect Redis
  try {
    const { connectRedis } = await import('../redis/client.js');
    await connectRedis();
    console.log('[Feeds] Redis connected');
  } catch (err) {
    console.warn('[Feeds] Redis unavailable:', (err as Error).message);
    console.warn('[Feeds] Feed data will not be cached. API routes will use direct fetches.');
  }

  // Start feed connectors
  try {
    const { registerAllFeeds, feedManager } = await import('./manager.js');
    await registerAllFeeds();
    await feedManager.startAll();
    console.log('[Feeds] All connectors running');
  } catch (err) {
    console.error('[Feeds] Failed to start connectors:', (err as Error).message);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Feeds] Shutting down...');
    try {
      const { feedManager } = await import('./manager.js');
      await feedManager.stopAll();
    } catch {
      /* ignore */
    }
    try {
      const { disconnectRedis } = await import('../redis/client.js');
      await disconnectRedis();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[Feeds] Fatal error:', err);
  process.exit(1);
});

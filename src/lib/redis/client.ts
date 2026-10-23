// ═══════════════════════════════════════════════
// COCOA AI THREAT DECK - Redis Client
// ioredis singleton with HMR-safe global pattern
// ═══════════════════════════════════════════════

import Redis, { type RedisOptions } from 'ioredis';

// ─── Configuration ───

// Fallback port must match docker-compose.yml (Phase 7.2 standalone migration:
// threatdeck-redis is on host port 6380, not the legacy 6379). Any environment
// without REDIS_URL set falls back here.
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

const BASE_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 10) return null; // Stop retrying after 10 attempts
    return Math.min(times * 200, 5_000); // Exponential backoff capped at 5s
  },
  lazyConnect: true,
  enableReadyCheck: true,
  connectTimeout: 10_000,
};

// ─── Singleton Pattern (HMR-safe) ───

const globalForRedis = globalThis as typeof globalThis & {
  _threatdeckRedis?: Redis;
  _threatdeckRedisSub?: Redis;
  _threatdeckRedisReady?: boolean;
};

function createRedisClient(name: string): Redis {
  const client = new Redis(REDIS_URL, {
    ...BASE_OPTIONS,
    // Surfaces in `redis-cli CLIENT LIST` for ops debugging — match the brand.
    connectionName: `threatdeck-${name}`,
  });

  client.on('error', (err: Error) => {
    console.error(`[Redis:${name}] Connection error:`, err.message);
  });

  client.on('connect', () => {
    console.log(`[Redis:${name}] Connected`);
  });

  client.on('ready', () => {
    console.log(`[Redis:${name}] Ready`);
  });

  client.on('close', () => {
    console.log(`[Redis:${name}] Connection closed`);
  });

  return client;
}

/**
 * Primary Redis client for commands (GET, SET, etc.)
 */
export const redis: Redis = globalForRedis._threatdeckRedis ?? createRedisClient('cmd');

/**
 * Dedicated subscriber client for pub/sub.
 * Once a client enters subscriber mode it can't be used for regular commands.
 */
export const redisSub: Redis = globalForRedis._threatdeckRedisSub ?? createRedisClient('sub');

// Next.js can load instrumentation and route bundles as separate modules in
// production. Share the actual clients, not only a global ready flag.
globalForRedis._threatdeckRedis = redis;
globalForRedis._threatdeckRedisSub = redisSub;

// ─── Connection Management ───

let _connectPromise: Promise<void> | null = null;

/**
 * Connect both Redis clients. Safe to call multiple times.
 */
export async function connectRedis(): Promise<void> {
  if (redis.status === 'ready' && redisSub.status === 'ready') return;

  if (!_connectPromise) {
    _connectPromise = (async () => {
      try {
        await Promise.all([redis.ping(), redisSub.ping()]);
        globalForRedis._threatdeckRedisReady = true;
        console.log('[Redis] Both clients connected');
      } catch (err) {
        console.warn('[Redis] Connection failed, running without Redis:', (err as Error).message);
        _connectPromise = null;
      }
    })();
  }

  return _connectPromise;
}

/**
 * Check if Redis is available and connected.
 */
export function isRedisConnected(): boolean {
  return redis.status === 'ready';
}

/**
 * Gracefully close both Redis connections.
 */
export async function disconnectRedis(): Promise<void> {
  globalForRedis._threatdeckRedisReady = false;
  _connectPromise = null;
  await Promise.allSettled([redis.quit(), redisSub.quit()]);
}

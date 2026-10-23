import { NextResponse } from 'next/server';
import { isRedisConnected, redis } from '@/lib/redis/client';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Either a static bucket key or a function deriving one from the request. */
  key: string | ((req: Request) => string);
  /** Max requests allowed within `windowMs`. */
  limit: number;
  /** Sliding window size in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still allowed in the current window (lower bound, can be 0). */
  remaining: number;
  /** Window length in seconds, advisory for the client's Retry-After. */
  retryAfterSeconds: number;
}

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response> | Response;

// ─────────────────────────────────────────────────────────────────────────────
// Client IP extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the originating client IP. Honors `x-forwarded-for` (Vercel and
 * most reverse proxies), falls back to `x-real-ip`, then to a literal
 * `'unknown'` so the bucket key is still stable.
 *
 * IMPORTANT: only trust forwarded headers behind a proxy you control. In
 * untrusted/edge contexts an attacker could spoof these to evade IP-based
 * limits. For Vercel/Cloudflare deployments this is the correct source.
 */
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY !== 'true') return 'unknown';
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    // x-forwarded-for can be a comma-separated chain; the leftmost entry is
    // the original client (subsequent entries are intermediate proxies).
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: sliding-window check via Redis sorted set
// ─────────────────────────────────────────────────────────────────────────────

const KEY_PREFIX = 'ratelimit:';

/**
 * Check (and atomically record) a hit against the bucket `key`. Returns
 * whether the request should be allowed plus advisory headers.
 *
 * Fails closed on any Redis error.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  // Fast path: if Redis isn't ready, fail closed without attempting commands.
  // The status check is cheap; calling commands on a not-ready client throws
  // and forces our catch path, which is fine but logs noise.
  if (!isRedisConnected()) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const bucketKey = `${KEY_PREFIX}${key}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  // Member must be unique so concurrent hits in the same ms don't collide.
  // We append a random suffix; the score still encodes the timestamp for
  // the sliding-window math.
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  try {
    // Atomic pipeline:
    //   1. Drop expired entries
    //   2. Add this hit
    //   3. Count entries in the live window
    //   4. Set TTL so cold keys auto-evict
    const results = await redis
      .multi()
      .zremrangebyscore(bucketKey, 0, windowStart)
      .zadd(bucketKey, now, member)
      .zcard(bucketKey)
      .pexpire(bucketKey, windowMs)
      .exec();

    // results is [[err, val], ...] — element [2] is ZCARD
    const zcardEntry = results?.[2];
    if (!results || results.some(([error]) => error) || typeof zcardEntry?.[1] !== 'number') {
      throw new Error('rate_limit_unavailable');
    }
    const count = zcardEntry[1];
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    return {
      allowed,
      remaining,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  } catch (err) {
    console.warn('[rate-limit] Redis error, denying request:', (err as Error).message);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }
}

/**
 * Give back the most recent hit in a bucket.
 *
 * For expensive, low-quota actions (video renders are 5/hour) a request that
 * never did the work shouldn't consume a slot — five failed attempts while a
 * credential is being fixed would otherwise lock the operator out for an hour
 * with zero renders and zero credits spent.
 *
 * Best-effort and non-throwing: the bucket is a sliding window, so dropping the
 * highest-scored member removes the hit we just added.
 */
/** Conservative: a bucket-only refund cannot identify its own reservation. */
export async function refundRateLimit(_key: string): Promise<void> {
  // Never remove another concurrent request's admission. Reservations expire.
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: route-handler wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a Next.js route handler with rate limiting. The wrapped handler will
 * short-circuit with a `429 Too Many Requests` response (including a
 * `Retry-After` header) when the bucket overflows.
 *
 * The bucket `key` should already be namespaced (e.g. `magic-link:1.2.3.4`)
 * — `withRateLimit` only adds a fixed `ratelimit:` prefix on top.
 */
export function withRateLimit<H extends RouteHandler>(handler: H, opts: RateLimitOptions): H {
  const wrapped = async (req: Request, ctx?: unknown): Promise<Response> => {
    const bucket = typeof opts.key === 'function' ? opts.key(req) : opts.key;
    const result = await checkRateLimit(bucket, opts.limit, opts.windowMs);

    if (!result.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: 'rate_limit_exceeded',
          detail: `Too many requests. Try again in ${result.retryAfterSeconds}s.`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(result.retryAfterSeconds),
            'X-RateLimit-Limit': String(opts.limit),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }

    const res = await handler(req, ctx);
    // Best-effort: enrich the success response with rate-limit headers so
    // clients can self-throttle before they hit the wall.
    try {
      res.headers.set('X-RateLimit-Limit', String(opts.limit));
      res.headers.set('X-RateLimit-Remaining', String(result.remaining));
    } catch {
      // Headers may be immutable on some response shapes — ignore.
    }
    return res;
  };

  return wrapped as H;
}

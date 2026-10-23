/**
 * Next.js instrumentation hook — runs once per server process at startup
 * (both `next dev` and the custom server).
 *
 * Purpose: LOCAL/long-running Twitter OAuth token keep-alive. Vercel Cron
 * (`/api/cron/twitter-refresh`) handles production, but it doesn't run on a
 * laptop — so during local development this in-process interval proactively
 * refreshes the token (~every 45 min, plus once shortly after boot) so a long
 * dev session stays connected to X without manual reconnects.
 *
 * Guards:
 *   - nodejs runtime only (skip the edge runtime).
 *   - NOT on Vercel (serverless instances are ephemeral — setInterval won't
 *     persist; the cron handles prod). `process.env.VERCEL` is set on Vercel.
 */

const KEEPALIVE_INTERVAL_MS = 45 * 60_000;
const KEEPALIVE_BOOT_DELAY_MS = 10_000;
const DB_PREFLIGHT_DELAY_MS = 1_500;

/**
 * One-shot connectivity probe at dev boot.
 *
 * A stopped Docker daemon takes down Postgres AND Redis at once, which breaks
 * nearly every surface — but only ever surfaced as downstream symptoms (an X
 * reconnect reporting `persist_failed`, empty panels, 500s). Failing loudly at
 * boot names the actual cause once, up front.
 *
 * Postgres is probed directly; Redis is only named in the message, not pinged —
 * importing the Redis client instantiates ioredis connections as a side effect,
 * which is too heavy for a health check. Both live in the same compose stack, so
 * one probe diagnoses the whole thing.
 */
async function dbPreflight(): Promise<void> {
  try {
    const { query } = await import('@/lib/db/client');
    await query('SELECT 1');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never print credentials from DATABASE_URL.
    const target =
      process.env.DATABASE_URL?.replace(/:\/\/[^@]*@/, '://***@') ?? '(DATABASE_URL is unset)';
    const rule = '='.repeat(68);
    console.error(
      [
        '',
        rule,
        '  DATABASE UNREACHABLE',
        `    ${target}`,
        `    ${message}`,
        '',
        '  Docker is probably not running. Fix:',
        '      docker compose up -d',
        '',
        '  Postgres AND Redis both live in that stack. Until it is up, AEGIS',
        '  panels, briefs, agent memory, the approval queue, and X posting +',
        '  reconnect will all fail.',
        rule,
        '',
      ].join('\n'),
    );
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { connectRedis } = await import('@/lib/redis/client');
  await connectRedis();
  const { isCapabilityEnabled } = await import('./lib/security/capabilities');
  if (!isCapabilityEnabled('automation') || !isCapabilityEnabled('x')) return;
  if (process.env.VERCEL) return; // production keep-alive is the Vercel cron

  setTimeout(() => {
    void dbPreflight();
  }, DB_PREFLIGHT_DELAY_MS);

  const tick = async (): Promise<void> => {
    try {
      const { proactiveRefreshToken } = await import('@/lib/twitter/oauth');
      const result = await proactiveRefreshToken();
      if (result.refreshed) {
        console.log('[twitter/keepalive] token refreshed proactively');
      } else if (!result.ok) {
        console.warn(`[twitter/keepalive] token not refreshed: ${result.reason} (reconnect X?)`);
      }
    } catch (err) {
      console.error('[twitter/keepalive] tick failed:', err);
    }
  };

  setTimeout(tick, KEEPALIVE_BOOT_DELAY_MS);
  setInterval(tick, KEEPALIVE_INTERVAL_MS);
  console.log(
    `[twitter/keepalive] local token keep-alive started (every ${KEEPALIVE_INTERVAL_MS / 60_000}m)`,
  );
}

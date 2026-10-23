import { auth } from '@/lib/auth';
import { isEmailAllowed } from '@/lib/auth/allowlist';
import { type Capability, isCapabilityEnabled } from './capabilities';
import { isTrustedOrigin } from './origin';
import { checkRateLimit, getClientIp } from './rate-limit';
import { boundedRequest } from './request-body';
import { hasCronSecret, matchesSecret } from './service-auth';

const CRON_PATHS = new Set([
  '/api/email/digest',
  '/api/email/alert',
  '/api/outbound/escalate',
  '/api/aegis/forecast-daily',
  '/api/aegis/forecast-outcomes',
  '/api/aegis/forecast-aggregations',
  '/api/aegis/geo-refresh',
  '/api/twitter/daily-brief',
  '/api/twitter/weekly-deepdive',
  '/api/twitter/predictions-thread',
  '/api/twitter/breaking',
]);

export function routeCapabilities(path: string): Capability[] {
  const required: Capability[] = [];
  if (
    /^\/api\/agent\/(invoke|stream|activate)$/.test(path) ||
    /\/data\/(ai-relevance|captions\/summarize)$/.test(path) ||
    path === '/api/aegis/pivot-suggestions' ||
    path === '/api/twitter/compose'
  )
    required.push('ai');
  if (path.startsWith('/api/email/') || path === '/api/outbound/escalate') required.push('email');
  if (path.startsWith('/api/twitter/') || path.startsWith('/api/outbound/x/')) required.push('x');
  if (path.includes('/generate-') || path.startsWith('/api/internal/video/'))
    required.push('media');
  if (path === '/api/outbound/email/replies' || path === '/api/cron/email-reply-scan')
    required.push('gmail');
  if (path.startsWith('/api/cron/') || CRON_PATHS.has(path) || path === '/api/agent/activate')
    required.push('automation');
  return required;
}

function reject(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** All API entrypoints must opt into this policy. Business services stay server-only. */
export function withRoutePolicy<A extends unknown[]>(
  path: string,
  handler: (...args: A) => Response | Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const request = args[0] as Request;
    if (!(request instanceof Request)) return reject('invalid_request', 400);
    if (path === '/api/health') return handler(...args);
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const cron = path.startsWith('/api/cron/') || CRON_PATHS.has(path);
    const internal = path.startsWith('/api/internal/video/');
    const authEntry = ['/api/auth/[...nextauth]', '/api/auth/magic-link'].includes(path);
    const blobCallback =
      path === '/api/agent/attachments/upload' && request.headers.has('x-vercel-signature');
    if (cron && !hasCronSecret(request)) return reject('unauthorized', 401);
    if (
      internal &&
      !matchesSecret(
        request.headers.get('x-internal-render-secret'),
        process.env.INTERNAL_RENDER_SECRET,
      )
    ) {
      return reject('unauthorized', 401);
    }
    let identity = getClientIp(request);
    if (!cron && !internal && !blobCallback) {
      if (!authEntry) {
        const session = await auth();
        const email = session?.user?.email;
        if (!email || !isEmailAllowed(email)) return reject('unauthorized', 401);
        identity = email.toLowerCase();
      }
      const origin = request.headers.get('origin');
      if ((mutating || origin) && !isTrustedOrigin(origin)) return reject('invalid_origin', 403);
      if (
        path === '/api/twitter/oauth/start' &&
        request.headers.get('sec-fetch-site') === 'cross-site'
      ) {
        return reject('invalid_origin', 403);
      }
    }
    for (const capability of routeCapabilities(path)) {
      if (!isCapabilityEnabled(capability)) return reject(`capability_disabled:${capability}`, 503);
    }
    if (mutating || cron || authEntry || internal || path === '/api/ws/token') {
      const routeKey = authEntry ? new URL(request.url).pathname : path;
      const limit = await checkRateLimit(
        `route:${routeKey}:${identity}`,
        authEntry && mutating ? 10 : 60,
        60_000,
      );
      if (!limit.allowed) return reject('rate_limit_unavailable_or_exceeded', 429);
    }
    if (mutating) {
      try {
        args[0] = (await boundedRequest(request)) as A[0];
      } catch {
        return reject('invalid_or_oversized_body', 413);
      }
    }
    try {
      const response = await handler(...args);
      if (
        response.status >= 500 &&
        response.headers.get('Content-Type')?.includes('application/json')
      )
        return reject('request_failed', response.status);
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return response;
    } catch {
      // Detailed provider/SQL errors can contain credentials or private rows.
      return reject('request_failed', 500);
    }
  };
}

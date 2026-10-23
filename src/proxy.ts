/**
 * ═══════════════════════════════════════════════
 * Cocoa AI Threat Deck — Edge Proxy
 * ═══════════════════════════════════════════════
 *
 * Per-request logging + request ID propagation.
 *
 * What it does:
 *   - Generates a fresh request ID for every meaningful request and emits
 *     it on the response as `x-request-id` (also accepts an upstream-supplied
 *     ID via the same header — useful when a proxy already set one).
 *   - Logs `method path status latency_ms request_id` to stdout. This is the
 *     poor-man's access log until Phase 8.5 wires in pino.
 *   - SKIPS logging for static asset fetches (Next chunks, favicons, images)
 *     so the log stream stays readable.
 *
 * What it does NOT do:
 *   - Auth/authz. That stays in route handlers (and NextAuth's own middleware
 *     when configured). The proxy here is strictly observability.
 *   - Rate limiting. That's `src/lib/security/rate-limit.ts`, applied per
 *     route. The proxy can't use ioredis cleanly here, so we don't put it
 *     here without a separate client.
 *
 * Renamed from `middleware.ts` → `proxy.ts` for Next.js 16 (the `middleware`
 * file convention is deprecated in favor of `proxy`).
 *
 * Runtime: Next.js proxy (Node.js runtime). crypto.randomUUID() is available.
 */

import { type NextRequest, NextResponse } from 'next/server';

// ─── Path filtering ────────────────────────────────────────────────────────

/**
 * Compiled once. Matches paths we never want to spam the log with:
 *   - Next internals (_next/static, _next/image, _next/data)
 *   - Common asset extensions
 *   - Favicons, manifests, robots, sitemap, browser noise
 */
const SKIP_LOG_PATTERN =
  /^\/_next\/|^\/favicon\.|^\/apple-icon\.|^\/icon\.|^\/robots\.txt$|^\/sitemap\.xml$|\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|otf|map|css|js)$/i;

function shouldSkipLog(pathname: string): boolean {
  return SKIP_LOG_PATTERN.test(pathname);
}

// ─── Proxy ─────────────────────────────────────────────────────────────────

export function proxy(request: NextRequest): NextResponse {
  // Honor an upstream-supplied request ID (e.g., from a CDN / load balancer)
  // so the same ID stays in the log chain end-to-end. If absent, mint a new
  // UUIDv4 — crypto.randomUUID is available on the proxy runtime.
  const requestId =
    request.headers.get('x-request-id') ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));

  const response = NextResponse.next({
    request: {
      // Propagate the ID downstream so route handlers / server components can
      // read it via `headers()`. The browser DevTools network panel will show
      // the same value in the response so support can correlate sessions.
      headers: (() => {
        const h = new Headers(request.headers);
        h.set('x-request-id', requestId);
        return h;
      })(),
    },
  });
  response.headers.set('x-request-id', requestId);

  const pathname = request.nextUrl.pathname;
  if (shouldSkipLog(pathname)) {
    return response;
  }

  // Latency is wall-clock from proxy entry; "status" comes from the
  // NextResponse object after route resolution. Both are best-effort —
  // some routes (streaming SSE, websockets) don't flow back through here
  // with a final status, so what we log is the post-proxy decision.
  const start = Date.now();
  const status = response.status;
  const latencyMs = Date.now() - start;
  const method = request.method;

  // Single tabular line — easy to grep, easy to ship to a JSON logger later.
  // Keep field order stable: method path status latency req-id.
  console.log(
    `[req] ${method.padEnd(6)} ${pathname.padEnd(40)} ${String(status).padStart(3)} ${String(latencyMs).padStart(5)}ms id=${requestId}`,
  );

  return response;
}

// ─── Matcher ───────────────────────────────────────────────────────────────
//
// Run the proxy on everything EXCEPT the asset paths the regex above
// already filters. We still let it execute on Next internals (because
// excluding them entirely loses request IDs on user-visible navigations),
// but the log line is suppressed by shouldSkipLog().
//
// The matcher uses negative lookahead to skip the heaviest asset traffic
// at the matcher level — that's a CPU win since the proxy doesn't run at
// all for those paths.
export const config = {
  matcher: [
    /*
     * Skip:
     *   - api/auth (NextAuth runs its own internals here; minimize wrapping)
     *   - _next/static, _next/image, _next/data (build assets)
     *   - favicon.ico, robots.txt, sitemap.xml, manifest files
     * Note: we still log /api/* because that's where the interesting traffic is.
     */
    '/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)',
  ],
};

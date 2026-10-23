/**
 * Shared-secret guard for machine-to-machine internal routes.
 *
 * Used by the Fly render worker's /api/internal/video/* executor routes. These
 * routes have no NextAuth session — the caller is the Vercel deployment's
 * remote video provider, which authenticates with the `x-internal-render-secret`
 * header set to INTERNAL_RENDER_SECRET.
 *
 * Returns 503 when the worker has no secret configured (treat as "video
 * disabled" — the remote provider maps this to a non-fatal 'disabled' state),
 * and 401 on a missing/mismatched header. Comparison is constant-time.
 */

import { timingSafeEqual } from 'node:crypto';

export type InternalSecretCheck = { ok: true } | { ok: false; status: 401 | 503 };

export function verifyInternalRenderSecret(req: Request): InternalSecretCheck {
  const expected = process.env.INTERNAL_RENDER_SECRET?.trim();
  if (!expected) return { ok: false, status: 503 };

  const provided = req.headers.get('x-internal-render-secret');
  if (!provided) return { ok: false, status: 401 };

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, status: 401 };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401 };
}

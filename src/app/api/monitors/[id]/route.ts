import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * PATCH/DELETE /api/monitors/[id] — update or remove a watchlist monitor.
 * Owner-scoped (the query's WHERE user_id = ... rejects other users' rows).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveOperatorUser } from '@/lib/auth/operator';
import { deleteMonitor, updateMonitor } from '@/lib/db/queries/monitors';
import { MONITOR_SEVERITIES, MONITOR_SOURCES } from '@/lib/monitors/constants';
import { isAllowedOrigin } from '@/lib/security/csrf';

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(50).optional(),
    severity: z.enum(MONITOR_SEVERITIES).optional(),
    sources: z.array(z.enum(MONITOR_SOURCES)).min(1).optional(),
    enabled: z.boolean().optional(),
    notifyOnMatch: z.boolean().optional(),
    color: z.string().max(32).optional(),
  })
  .strict();

async function getId(ctx: RouteContext): Promise<string> {
  return (await Promise.resolve(ctx.params)).id;
}

async function routePATCHImplementation(
  request: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'cross_origin_blocked' }, { status: 403 });
  }
  const user = await resolveOperatorUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_patch', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const monitor = await updateMonitor(await getId(ctx), user.id, parsed.data);
  if (!monitor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ monitor });
}

async function routeDELETEImplementation(
  request: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'cross_origin_blocked' }, { status: 403 });
  }
  const user = await resolveOperatorUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ok = await deleteMonitor(await getId(ctx), user.id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

export const PATCH = withRoutePolicy('/api/monitors/[id]', routePATCHImplementation);
export const DELETE = withRoutePolicy('/api/monitors/[id]', routeDELETEImplementation);

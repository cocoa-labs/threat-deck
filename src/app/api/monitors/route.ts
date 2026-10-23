import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET/POST /api/monitors — keyword watchlists (Phase 2).
 *
 * GET lists the session user's monitors. POST creates one. Owner-scoped via the
 * NextAuth session (allowlisted email); POST enforces same-origin.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveOperatorUser } from '@/lib/auth/operator';
import { createMonitor, listMonitorsWithStats } from '@/lib/db/queries/monitors';
import { MONITOR_SEVERITIES, MONITOR_SOURCES } from '@/lib/monitors/constants';
import { isAllowedOrigin } from '@/lib/security/csrf';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  severity: z.enum(MONITOR_SEVERITIES).default('medium'),
  sources: z
    .array(z.enum(MONITOR_SOURCES))
    .min(1)
    .default([...MONITOR_SOURCES]),
  color: z.string().max(32).optional(),
  notifyOnMatch: z.boolean().optional(),
});

async function routeGETImplementation(): Promise<NextResponse> {
  const user = await resolveOperatorUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const monitors = await listMonitorsWithStats(user.id);
  return NextResponse.json({ monitors });
}

async function routePOSTImplementation(request: Request): Promise<NextResponse> {
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_monitor', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const monitor = await createMonitor({ userId: user.id, ...parsed.data });
  return NextResponse.json({ monitor }, { status: 201 });
}

export const GET = withRoutePolicy('/api/monitors', routeGETImplementation);
export const POST = withRoutePolicy('/api/monitors', routePOSTImplementation);

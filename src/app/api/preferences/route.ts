import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET/PATCH /api/preferences — DB-per-user config blob (Phase 2).
 *
 * GET returns the current user's preferences (defaults-merged) + focus areas.
 * PATCH deep-merges a partial set of sections into `users.preferences` so a
 * partial-section update never resets the unspecified fields.
 *
 * Auth: NextAuth session (allowlisted email). PATCH also enforces same-origin.
 * The owner row is resolved via `resolveOperatorUser()`, which upserts on first
 * touch — JWT sessions never create `users` rows, so GET used to silently serve
 * defaults forever and PATCH returned 404 `no_user`, i.e. preferences appeared
 * to save and never did.
 */

import { NextResponse } from 'next/server';
import { resolveOperatorUser } from '@/lib/auth/operator';
import { updateUserPreferences } from '@/lib/db/queries/users';
import {
  mergePreferences,
  parsePreferences,
  userPreferencesPatchSchema,
} from '@/lib/preferences/schema';
import { isAllowedOrigin } from '@/lib/security/csrf';

async function routeGETImplementation(): Promise<NextResponse> {
  const user = await resolveOperatorUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    preferences: parsePreferences(user.preferences),
    focusAreas: user.focus_areas ?? [],
  });
}

async function routePATCHImplementation(request: Request): Promise<NextResponse> {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'cross_origin_blocked' }, { status: 403 });
  }
  const user = await resolveOperatorUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const parsed = userPreferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_preferences', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const merged = mergePreferences(parsePreferences(user.preferences), parsed.data);
  await updateUserPreferences(user.id, merged);
  return NextResponse.json({ preferences: merged });
}

export const GET = withRoutePolicy('/api/preferences', routeGETImplementation);
export const PATCH = withRoutePolicy('/api/preferences', routePATCHImplementation);

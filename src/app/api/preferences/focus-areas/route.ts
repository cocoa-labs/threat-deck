import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * PUT /api/preferences/focus-areas — set the user's focus areas (Phase 2).
 *
 * focus_areas already flows into the agent system prompt (prompts.ts) but had no
 * writer until now. The daily ritual + agent context use it to bias relevance.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveOperatorUser } from '@/lib/auth/operator';
import { updateUserFocusAreas } from '@/lib/db/queries/users';
import { isAllowedOrigin } from '@/lib/security/csrf';

const bodySchema = z.object({
  focusAreas: z.array(z.string().trim().min(1).max(80)).max(50),
});

async function routePUTImplementation(request: Request): Promise<NextResponse> {
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_focus_areas', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await updateUserFocusAreas(user.id, parsed.data.focusAreas);
  return NextResponse.json({ focusAreas: parsed.data.focusAreas });
}

export const PUT = withRoutePolicy('/api/preferences/focus-areas', routePUTImplementation);

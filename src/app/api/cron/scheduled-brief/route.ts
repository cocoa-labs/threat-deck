import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET/POST /api/cron/scheduled-brief?name=<trigger> — fire one SCHEDULE_TRIGGER.
 *
 * The four scheduled briefs (morning / midday / close / overnight) were defined
 * in `SCHEDULE_TRIGGERS` and run by an in-process `setInterval` scheduler that
 * nothing ever started — and which couldn't have worked on Vercel anyway, since
 * serverless functions don't hold a long-lived timer. They are now Vercel Crons
 * like every other scheduled job in this app (see vercel.json).
 *
 * Auth via checkCronSecret, matching the sibling cron routes.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { processEvent, SCHEDULE_TRIGGERS } from '@/lib/agent/activation';
import { registerAllTools } from '@/lib/agent/tools';

registerAllTools();

async function run(request: Request): Promise<NextResponse> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason ?? 'auth failed' }, { status: 401 });
  }

  const name = new URL(request.url).searchParams.get('name');
  const schedule = SCHEDULE_TRIGGERS.find((s) => s.name === name);
  if (!schedule) {
    return NextResponse.json(
      { ok: false, error: 'unknown_schedule', valid: SCHEDULE_TRIGGERS.map((s) => s.name) },
      { status: 400 },
    );
  }

  try {
    const result = await processEvent(`schedule.${schedule.name}`, {
      schedule_name: schedule.name,
      task: schedule.task,
    });
    return NextResponse.json({ ok: true, name: schedule.name, fired: Boolean(result) });
  } catch (err) {
    // Fail-soft — a failed brief must not retry-storm the cron.
    return NextResponse.json({
      ok: false,
      name: schedule.name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function routeGETImplementation(request: Request): Promise<NextResponse> {
  return run(request);
}

async function routePOSTImplementation(request: Request): Promise<NextResponse> {
  return run(request);
}

export const GET = withRoutePolicy('/api/cron/scheduled-brief', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/scheduled-brief', routePOSTImplementation);

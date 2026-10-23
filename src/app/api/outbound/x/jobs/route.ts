import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { listActiveXPostJobs } from '@/lib/twitter/x-post-job-service';
export const dynamic = 'force-dynamic';
async function handleList(): Promise<Response> {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const jobs = await listActiveXPostJobs(actorEmail);
  return NextResponse.json({ ok: true, jobs }, { status: 200 });
}

export const GET = withRoutePolicy('/api/outbound/x/jobs', handleList);
export const POST = withRoutePolicy('/api/outbound/x/jobs', async (_request: Request) =>
  Response.json({ ok: false, error: 'Use /api/outbound/x/review.' }, { status: 410 }),
);

import { withRoutePolicy } from '@/lib/security/route-policy';

function retired(): Response {
  return Response.json({ error: 'Use the outbound draft review queue' }, { status: 410 });
}
export const GET = withRoutePolicy('/api/agent/approve', retired);
export const POST = withRoutePolicy('/api/agent/approve', retired);

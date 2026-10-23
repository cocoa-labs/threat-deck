import { auth } from '@/lib/auth';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { issueWSTicket } from '@/lib/ws/tickets';

export const POST = withRoutePolicy('/api/ws/token', async () => {
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ ticket: await issueWSTicket(session.user.email), expiresIn: 60 });
});

import { auth } from '@/lib/auth';
import { capabilityStatus } from '@/lib/security/capabilities';
import { withRoutePolicy } from '@/lib/security/route-policy';

export const GET = withRoutePolicy('/api/capabilities', async () =>
  Response.json({ capabilities: capabilityStatus(), operator: (await auth())?.user?.email }),
);

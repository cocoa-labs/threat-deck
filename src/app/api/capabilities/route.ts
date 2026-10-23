import { capabilityStatus } from '@/lib/security/capabilities';
import { withRoutePolicy } from '@/lib/security/route-policy';

export const GET = withRoutePolicy('/api/capabilities', () =>
  Response.json({ capabilities: capabilityStatus() }),
);

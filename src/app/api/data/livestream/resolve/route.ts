import { GET as dataGET } from '@/lib/data/services/livestream/resolve';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/livestream/resolve', routeGETImplementation);

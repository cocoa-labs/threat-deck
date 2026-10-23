import { GET as dataGET } from '@/lib/data/services/crypto';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/crypto', routeGETImplementation);

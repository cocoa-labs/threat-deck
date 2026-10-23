import { GET as dataGET } from '@/lib/data/services/markets';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/markets', routeGETImplementation);

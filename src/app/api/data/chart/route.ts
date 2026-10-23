import { GET as dataGET } from '@/lib/data/services/chart';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/chart', routeGETImplementation);

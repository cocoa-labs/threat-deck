import { GET as dataGET } from '@/lib/data/services/tv-context';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/tv-context', routeGETImplementation);

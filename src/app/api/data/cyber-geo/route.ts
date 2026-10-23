import { GET as dataGET } from '@/lib/data/services/cyber-geo';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/cyber-geo', routeGETImplementation);

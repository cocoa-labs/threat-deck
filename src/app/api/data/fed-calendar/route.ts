import { GET as dataGET } from '@/lib/data/services/fed-calendar';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/fed-calendar', routeGETImplementation);

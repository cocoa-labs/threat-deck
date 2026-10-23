import { GET as dataGET } from '@/lib/data/services/threat-actors';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/threat-actors', routeGETImplementation);

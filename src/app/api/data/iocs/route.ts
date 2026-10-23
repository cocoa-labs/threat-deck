import { GET as dataGET } from '@/lib/data/services/iocs';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/iocs', routeGETImplementation);

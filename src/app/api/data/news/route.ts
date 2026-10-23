import { GET as dataGET } from '@/lib/data/services/news';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/news', routeGETImplementation);

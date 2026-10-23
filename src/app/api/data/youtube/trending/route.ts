import { GET as dataGET } from '@/lib/data/services/youtube/trending';
import { withRoutePolicy } from '@/lib/security/route-policy';

const routeGETImplementation = dataGET;

export const GET = withRoutePolicy('/api/data/youtube/trending', routeGETImplementation);

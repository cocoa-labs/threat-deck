/** Internal dispatch avoids self-HTTP and never forwards credentials. */
const services: Record<string, () => Promise<{ GET: (...args: never[]) => Promise<Response> }>> = {
  '/api/data/advisories': () => import('./services/advisories'),
  '/api/data/alerts': () => import('./services/alerts'),
  '/api/data/breaches': () => import('./services/breaches'),
  '/api/data/chart': () => import('./services/chart'),
  '/api/data/congress': () => import('./services/congress'),
  '/api/data/crypto': () => import('./services/crypto'),
  '/api/data/cves': () => import('./services/cves'),
  '/api/data/cyber-geo': () => import('./services/cyber-geo'),
  '/api/data/earnings': () => import('./services/earnings'),
  '/api/data/fed': () => import('./services/fed'),
  '/api/data/fed-calendar': () => import('./services/fed-calendar'),
  '/api/data/geocode': () => import('./services/geocode'),
  '/api/data/government': () => import('./services/government'),
  '/api/data/iocs': () => import('./services/iocs'),
  '/api/data/kev': () => import('./services/kev'),
  '/api/data/livestream/resolve': () => import('./services/livestream/resolve'),
  '/api/data/markets': () => import('./services/markets'),
  '/api/data/news': () => import('./services/news'),
  '/api/data/osint': () => import('./services/osint'),
  '/api/data/patches': () => import('./services/patches'),
  '/api/data/polymarket': () => import('./services/polymarket'),
  '/api/data/threat-actors': () => import('./services/threat-actors'),
  '/api/data/tv-context': () => import('./services/tv-context'),
  '/api/data/twitter': () => import('./services/twitter'),
  '/api/data/whales': () => import('./services/whales'),
  '/api/data/youtube/search': () => import('./services/youtube/search'),
  '/api/data/youtube/trending': () => import('./services/youtube/trending'),
};

export async function dataRequest(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, 'http://service.invalid');
  if (!Object.hasOwn(services, url.pathname)) throw new Error('unknown_data_service');
  const load = services[url.pathname];
  if (!load || (init?.method && init.method !== 'GET')) throw new Error('unknown_data_service');
  const service = await load();
  return service.GET(new Request(url, init) as never);
}

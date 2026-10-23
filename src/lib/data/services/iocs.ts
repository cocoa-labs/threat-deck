import type { NextResponse } from 'next/server';
import {
  fetchMalwareBazaarSamples,
  fetchThreatfoxIndicators,
  fetchUrlhausIocs,
} from '@/lib/data/collectors/threat-iocs';
import { feedResponse } from '@/lib/data/feed-response';
import type { IOC, IocType } from '@/lib/types';

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

const VALID_IOC_TYPES: ReadonlySet<IocType> = new Set([
  'sha256',
  'md5',
  'url',
  'ip',
  'domain',
  'email',
]);

const VALID_SOURCES = new Set(['urlhaus', 'malwarebazaar', 'threatfox']);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source')?.toLowerCase();
  const iocTypeParam = searchParams.get('ioc_type')?.toLowerCase();
  const iocType =
    iocTypeParam && VALID_IOC_TYPES.has(iocTypeParam as IocType)
      ? (iocTypeParam as IocType)
      : undefined;
  const limit = Number(searchParams.get('limit')) || 100;

  try {
    let iocs: IOC[] = [];

    if (source && VALID_SOURCES.has(source)) {
      if (source === 'urlhaus') iocs = await fetchUrlhausIocs(limit);
      else if (source === 'malwarebazaar') iocs = await fetchMalwareBazaarSamples(limit);
      else if (source === 'threatfox') iocs = await fetchThreatfoxIndicators(limit);
    } else {
      // No source: aggregate all three.
      const perSource = Math.max(10, Math.ceil(limit / 3));
      const [urlhaus, mb, tf] = await Promise.all([
        fetchUrlhausIocs(perSource),
        fetchMalwareBazaarSamples(perSource),
        fetchThreatfoxIndicators(perSource),
      ]);
      iocs = [...urlhaus, ...mb, ...tf];

      // Sort by lastSeen desc (fall back to firstSeen) so the freshest IOCs rise.
      iocs.sort((a, b) => {
        const ad = new Date(a.lastSeen ?? a.firstSeen ?? 0).getTime();
        const bd = new Date(b.lastSeen ?? b.firstSeen ?? 0).getTime();
        return bd - ad;
      });
    }

    if (iocType) {
      iocs = iocs.filter((i) => i.iocType === iocType);
    }

    const trimmed = iocs.slice(0, limit);

    return withCacheHeaders(
      feedResponse({
        data: trimmed,
        count: trimmed.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch IOCs' },
      { status: 500 },
    );
  }
}

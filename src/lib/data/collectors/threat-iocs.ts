/**
 * Threat IOC collector — fetches indicators of compromise from abuse.ch
 * free public APIs.
 *
 * Sources (all abuse.ch — Auth-Key required since 2024; set ABUSECH_AUTH_KEY):
 * - URLhaus (malicious URLs, GET): https://urlhaus-api.abuse.ch/v1/urls/recent/
 * - MalwareBazaar (malware samples): https://mb-api.abuse.ch/api/v1/
 * - ThreatFox (IOC database): https://threatfox-api.abuse.ch/api/v1/
 *
 * NOTE: As of 2024 abuse.ch moved to an Auth-Key model for some endpoints.
 * If the unauthenticated endpoint returns 401/403, we fall back to DEMO data
 * and surface a console warning so the operator knows to set
 * `ABUSECH_AUTH_KEY` (optional).
 */

import type { IOC, IocType } from '@/lib/types';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from '../rate-limiter';

const URLHAUS_URL = 'https://urlhaus-api.abuse.ch/v1/urls/recent/';
const MALWARE_BAZAAR_URL = 'https://mb-api.abuse.ch/api/v1/';
const THREATFOX_URL = 'https://threatfox-api.abuse.ch/api/v1/';
const USER_AGENT =
  'Mozilla/5.0 (compatible; CocoaThreatDeck/1.0; +https://github.com/cocoa-labs/threat-deck)';

// ─── Demo data ───

const DEMO_IOCS: IOC[] = [
  {
    iocType: 'sha256',
    value: 'a5e8b1f0c2d4e7a3b9c1d8e5f7a2b4c6d9e0f1a3b5c7d8e9f0a1b2c3d4e5f6a7',
    firstSeen: '2026-05-21T12:00:00Z',
    lastSeen: '2026-05-22T09:30:00Z',
    source: 'malwarebazaar',
    confidence: 0.92,
    tags: ['ransomware', 'lockbit', 'win64'],
  },
  {
    iocType: 'url',
    value: 'http://198.51.100.42/payload/loader.bin',
    firstSeen: '2026-05-22T03:15:00Z',
    lastSeen: '2026-05-22T11:00:00Z',
    source: 'urlhaus',
    confidence: 0.88,
    tags: ['malware-distribution', 'emotet'],
  },
  {
    iocType: 'domain',
    value: 'update-checker[.]xyz',
    firstSeen: '2026-05-20T18:00:00Z',
    lastSeen: '2026-05-22T08:00:00Z',
    source: 'threatfox',
    confidence: 0.95,
    tags: ['c2', 'cobaltstrike'],
  },
  {
    iocType: 'ip',
    value: '203.0.113.77',
    firstSeen: '2026-05-19T22:00:00Z',
    lastSeen: '2026-05-22T07:45:00Z',
    source: 'threatfox',
    confidence: 0.78,
    tags: ['c2', 'apt29'],
    relatedActorId: 'apt29',
  },
  {
    iocType: 'sha256',
    value: 'd1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2',
    firstSeen: '2026-05-18T08:00:00Z',
    lastSeen: '2026-05-22T10:00:00Z',
    source: 'malwarebazaar',
    confidence: 0.9,
    tags: ['stealer', 'redline'],
  },
];

// ─── URLhaus response shape ───

interface UrlhausEntry {
  id?: string;
  url?: string;
  url_status?: string;
  date_added?: string;
  last_online?: string;
  threat?: string;
  tags?: string[];
  reporter?: string;
  larted?: string;
}

interface UrlhausResponse {
  query_status?: string;
  urls?: UrlhausEntry[];
}

// ─── MalwareBazaar response shape ───

interface MbEntry {
  sha256_hash?: string;
  md5_hash?: string;
  first_seen?: string;
  last_seen?: string;
  file_type?: string;
  signature?: string;
  tags?: string[];
  reporter?: string;
}

interface MbResponse {
  query_status?: string;
  data?: MbEntry[];
}

// ─── ThreatFox response shape ───

interface TfEntry {
  id?: string;
  ioc?: string;
  ioc_type?: string;
  threat_type?: string;
  malware?: string;
  confidence_level?: number;
  first_seen?: string;
  last_seen?: string;
  tags?: string[];
  reference?: string;
}

interface TfResponse {
  query_status?: string;
  data?: TfEntry[];
}

// ─── Helpers ───

function inferIocType(raw: string | undefined): IocType {
  if (!raw) return 'url';
  const v = raw.toLowerCase();
  if (v.includes('sha256')) return 'sha256';
  if (v.includes('md5')) return 'md5';
  if (v.includes('url')) return 'url';
  if (v.includes('ip')) return 'ip';
  if (v.includes('domain') || v.includes('host')) return 'domain';
  if (v.includes('email')) return 'email';
  return 'url';
}

function buildAbusechHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // abuse.ch added auth keys in 2024; honor it if the operator provides one.
  const authKey = process.env.ABUSECH_AUTH_KEY;
  if (authKey) headers['Auth-Key'] = authKey;
  return headers;
}

// ─── Public API ───

/**
 * Fetch recent malicious URLs from URLhaus.
 * Returns DEMO_IOCS on failure — never throws.
 */
export async function fetchUrlhausIocs(limit: number = 100): Promise<IOC[]> {
  const cacheKey = `iocs:urlhaus:${limit}:v1`;
  const cached = await getCached<IOC[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('abusech')) return DEMO_IOCS.filter((i) => i.source === 'urlhaus');
  if (!checkRateLimit('abusech')) return DEMO_IOCS.filter((i) => i.source === 'urlhaus');

  try {
    // URLhaus' recent-URLs endpoint is GET-only (POST → 405 "http_get_expected").
    // It returns the most recent URLs; we slice to `limit` below.
    const res = await fetchWithTimeout(URLHAUS_URL, {
      method: 'GET',
      headers: buildAbusechHeaders(),
      cache: 'no-store',
    });

    if (res.status === 429) {
      setBackoff('abusech', 15 * 60_000);
      return DEMO_IOCS.filter((i) => i.source === 'urlhaus');
    }
    if (!res.ok) {
      console.warn(`[IOC] URLhaus returned ${res.status} — abuse.ch may require ABUSECH_AUTH_KEY`);
      return DEMO_IOCS.filter((i) => i.source === 'urlhaus');
    }

    const data = (await res.json()) as UrlhausResponse;
    if (data.query_status !== 'ok' || !data.urls) {
      return DEMO_IOCS.filter((i) => i.source === 'urlhaus');
    }

    const iocs: IOC[] = data.urls.slice(0, limit).map((e) => ({
      iocType: 'url',
      value: e.url ?? '',
      firstSeen: e.date_added,
      lastSeen: e.last_online ?? e.date_added,
      source: 'urlhaus',
      confidence: 0.85,
      tags: e.tags ?? (e.threat ? [e.threat] : []),
    }));

    const filtered = iocs.filter((i) => i.value);
    if (filtered.length === 0) return DEMO_IOCS.filter((i) => i.source === 'urlhaus');

    await setCache(cacheKey, filtered);
    return filtered;
  } catch (err) {
    console.warn('[IOC] URLhaus fetch failed:', err instanceof Error ? err.message : err);
    return DEMO_IOCS.filter((i) => i.source === 'urlhaus');
  }
}

/**
 * Fetch recent malware samples from MalwareBazaar.
 * Returns DEMO_IOCS on failure — never throws.
 */
export async function fetchMalwareBazaarSamples(limit: number = 100): Promise<IOC[]> {
  const cacheKey = `iocs:malwarebazaar:${limit}:v1`;
  const cached = await getCached<IOC[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('abusech')) return DEMO_IOCS.filter((i) => i.source === 'malwarebazaar');
  if (!checkRateLimit('abusech')) return DEMO_IOCS.filter((i) => i.source === 'malwarebazaar');

  try {
    const res = await fetchWithTimeout(MALWARE_BAZAAR_URL, {
      method: 'POST',
      headers: buildAbusechHeaders(),
      body: new URLSearchParams({ query: 'get_recent', selector: 'time' }),
      cache: 'no-store',
    });

    if (res.status === 429) {
      setBackoff('abusech', 15 * 60_000);
      return DEMO_IOCS.filter((i) => i.source === 'malwarebazaar');
    }
    if (!res.ok) {
      console.warn(
        `[IOC] MalwareBazaar returned ${res.status} — abuse.ch may require ABUSECH_AUTH_KEY`,
      );
      return DEMO_IOCS.filter((i) => i.source === 'malwarebazaar');
    }

    const data = (await res.json()) as MbResponse;
    if (data.query_status !== 'ok' || !data.data) {
      return DEMO_IOCS.filter((i) => i.source === 'malwarebazaar');
    }

    const iocs: IOC[] = data.data.slice(0, limit).map((e) => ({
      iocType: 'sha256',
      value: e.sha256_hash ?? '',
      firstSeen: e.first_seen,
      lastSeen: e.last_seen ?? e.first_seen,
      source: 'malwarebazaar',
      confidence: 0.9,
      tags: [
        ...(e.tags ?? []),
        ...(e.signature ? [e.signature] : []),
        ...(e.file_type ? [e.file_type] : []),
      ],
    }));

    const filtered = iocs.filter((i) => i.value);
    if (filtered.length === 0) return DEMO_IOCS.filter((i) => i.source === 'malwarebazaar');

    await setCache(cacheKey, filtered);
    return filtered;
  } catch (err) {
    console.warn('[IOC] MalwareBazaar fetch failed:', err instanceof Error ? err.message : err);
    return DEMO_IOCS.filter((i) => i.source === 'malwarebazaar');
  }
}

/**
 * Fetch recent IOCs from ThreatFox (last 1 day).
 * Returns DEMO_IOCS on failure — never throws.
 */
export async function fetchThreatfoxIndicators(limit: number = 100): Promise<IOC[]> {
  const cacheKey = `iocs:threatfox:${limit}:v1`;
  const cached = await getCached<IOC[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('abusech')) return DEMO_IOCS.filter((i) => i.source === 'threatfox');
  if (!checkRateLimit('abusech')) return DEMO_IOCS.filter((i) => i.source === 'threatfox');

  try {
    const res = await fetchWithTimeout(THREATFOX_URL, {
      method: 'POST',
      headers: { ...buildAbusechHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'get_iocs', days: 1 }),
      cache: 'no-store',
    });

    if (res.status === 429) {
      setBackoff('abusech', 15 * 60_000);
      return DEMO_IOCS.filter((i) => i.source === 'threatfox');
    }
    if (!res.ok) {
      console.warn(
        `[IOC] ThreatFox returned ${res.status} — abuse.ch may require ABUSECH_AUTH_KEY`,
      );
      return DEMO_IOCS.filter((i) => i.source === 'threatfox');
    }

    const data = (await res.json()) as TfResponse;
    if (data.query_status !== 'ok' || !data.data) {
      return DEMO_IOCS.filter((i) => i.source === 'threatfox');
    }

    const iocs: IOC[] = data.data.slice(0, limit).map((e) => ({
      iocType: inferIocType(e.ioc_type),
      value: e.ioc ?? '',
      firstSeen: e.first_seen,
      lastSeen: e.last_seen ?? e.first_seen,
      source: 'threatfox',
      confidence:
        typeof e.confidence_level === 'number' ? Math.min(1, e.confidence_level / 100) : 0.75,
      tags: [
        ...(e.tags ?? []),
        ...(e.malware ? [e.malware] : []),
        ...(e.threat_type ? [e.threat_type] : []),
      ],
    }));

    const filtered = iocs.filter((i) => i.value);
    if (filtered.length === 0) return DEMO_IOCS.filter((i) => i.source === 'threatfox');

    await setCache(cacheKey, filtered);
    return filtered;
  } catch (err) {
    console.warn('[IOC] ThreatFox fetch failed:', err instanceof Error ? err.message : err);
    return DEMO_IOCS.filter((i) => i.source === 'threatfox');
  }
}

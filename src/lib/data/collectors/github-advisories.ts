import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * GitHub Security Advisories (GHSA) collector — GitHub REST Advisory Database.
 *
 * GHSA is a fast, high-signal, reviewed advisory firehose covering the open-
 * source ecosystem (npm / PyPI / Maven / Go / RubyGems / NuGet / Composer / etc.).
 * Many GHSA entries are published with a `cve_id` mapping, but GHSA is typically
 * faster to publish than NVD — so it's a useful early-warning advisory source.
 *
 * Source:
 * - https://api.github.com/advisories (public, no auth required; an optional
 *   GITHUB_TOKEN / GH_TOKEN raises the 60/hr unauthenticated limit to 5000/hr).
 *
 * Resilience pattern mirrors src/lib/data/collectors/breach-feed.ts:
 *   cache → rate limit → fetch → fallback → never throw.
 *
 * Unlike the breach/vendor collectors, GHSA does NOT fall back to synthetic
 * demo advisories — fabricated advisory IDs would pollute `aegis_advisories`
 * (keyed on the real `ghsa_id`) and erode trust in citations. On any failure
 * we return an empty array; the next ingest tick catches up.
 */

import type { Advisory, CveSeverity } from '@/lib/types';
import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from '../rate-limiter';

const GHSA_BASE = 'https://api.github.com/advisories';
const USER_AGENT = 'cocoa-threat-deck/1.0';

// ─── GitHub Advisory API response shape (fields we consume) ───

interface GhsaPackage {
  ecosystem?: string;
  name?: string;
}

interface GhsaVulnerability {
  package?: GhsaPackage | null;
}

interface GhsaAdvisory {
  ghsa_id?: string;
  cve_id?: string | null;
  summary?: string;
  description?: string;
  severity?: string; // low | moderate | high | critical (GHSA scale)
  published_at?: string;
  html_url?: string;
  vulnerabilities?: GhsaVulnerability[] | null;
}

// ─── Helpers ───

/**
 * Map the GHSA severity scale onto our `CveSeverity` union.
 * GHSA uses `moderate`; we normalize that to `medium`. Unknown values fall
 * back to `medium` so a row is never dropped purely for an unexpected label.
 */
function mapSeverity(severity: string | undefined): CveSeverity {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'moderate':
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'medium';
  }
}

/** Dedupe affected package names while preserving first-seen order. */
function extractAffectedProducts(vulns: GhsaVulnerability[] | null | undefined): string[] {
  if (!Array.isArray(vulns)) return [];
  const names: string[] = [];
  for (const v of vulns) {
    const name = v?.package?.name;
    if (name) names.push(name);
  }
  return Array.from(new Set(names));
}

function mapAdvisory(item: GhsaAdvisory, idx: number): Advisory | null {
  const advisoryId = item.ghsa_id?.trim();
  // ghsa_id is the UNIQUE upsert key — a row without it is unusable.
  if (!advisoryId) return null;

  return {
    id: idx, // surrogate; the DB ignores this on ingest (upsert keys on ghsa_id)
    advisoryId,
    issuer: 'vendor',
    issuerGeography: 'global',
    publishedAt: item.published_at ?? new Date().toISOString(),
    severity: mapSeverity(item.severity),
    title: item.summary ?? undefined,
    summary: item.description ? item.description.slice(0, 500) : undefined,
    affectedCves: item.cve_id ? [item.cve_id] : [],
    affectedProducts: extractAffectedProducts(item.vulnerabilities),
    advisoryUrl: item.html_url ?? `https://github.com/advisories/${advisoryId}`,
  };
}

// ─── Public API ───

/**
 * Fetch the most recently published reviewed GitHub Security Advisories,
 * mapped to the `Advisory` shape. Returns `[]` on any failure — never throws.
 */
export async function fetchGithubAdvisories(limit: number = 50): Promise<Advisory[]> {
  const cacheKey = `ghsa:advisories:${limit}:v1`;
  const cached = await getCached<Advisory[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('ghsa')) return [];
  if (!checkRateLimit('ghsa')) return [];

  const perPage = Math.min(Math.max(1, limit), 100);
  const url = `${GHSA_BASE}?per_page=${perPage}&sort=published&direction=desc&type=reviewed`;

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await safeFetch(url, { headers, cache: 'no-store' });

    // 403 (rate-limit / abuse) and 429 → back off so we stop hammering GitHub.
    if (res.status === 403 || res.status === 429) {
      setBackoff('ghsa', 15 * 60_000);
      return [];
    }
    if (!res.ok) {
      console.warn(`[GHSA] GitHub advisories returned ${res.status}`);
      return [];
    }

    const raw = (await res.json()) as GhsaAdvisory[];
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const advisories: Advisory[] = [];
    for (const item of raw) {
      const mapped = mapAdvisory(item, advisories.length);
      if (mapped) advisories.push(mapped);
    }

    advisories.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
    const trimmed = advisories.slice(0, limit);

    await setCache(cacheKey, trimmed);
    return trimmed;
  } catch (err) {
    console.warn('[GHSA] fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

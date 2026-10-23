import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * Vendor security advisories collector — fetches RSS feeds from major
 * software vendors and normalizes them into the `Advisory` shape.
 *
 * Per the existing `rss.ts` pattern, each feed is parsed independently
 * with `Promise.allSettled` so a single broken feed never blocks the rest.
 * Affected CVE IDs are extracted from titles and content via regex.
 *
 * Sources (RSS-only — vendors without clean RSS are documented inline):
 * - Microsoft MSRC blog (best-effort proxy for advisories)
 * - Apple security releases — RSS feed availability is unreliable,
 *   currently falls back to DEMO_ data. TODO: scrape support page.
 * - Ubuntu USN
 * - Red Hat security updates
 * - Chrome Releases (Google)
 * - Mozilla MFSA
 */

import Parser from 'rss-parser';
import { markFallback } from '@/lib/data/fallback';
import type { Advisory, CveSeverity } from '@/lib/types';
import { createRssAdvisoryId, dedupeAdvisoriesByIdentity } from '@/lib/utils/advisory-identity';
import { stableNumericId, withStableAdvisoryIds } from '@/lib/utils/stable-id';
import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from '../rate-limiter';

const USER_AGENT =
  'Mozilla/5.0 (compatible; CocoaThreatDeck/1.0; +https://github.com/cocoa-labs/threat-deck)';
const CVE_RE = /CVE-\d{4}-\d{4,}/g;

const parser = new Parser({
  timeout: 10_000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

export type VendorKey = 'microsoft' | 'apple' | 'ubuntu' | 'redhat' | 'chrome' | 'mozilla';

interface VendorFeed {
  vendor: VendorKey;
  name: string;
  url: string;
  // Severity hint when the feed doesn't expose one; helps populate the field.
  defaultSeverity?: CveSeverity;
}

/**
 * `defaultSeverity` is the floor for a release whose TITLE says nothing about
 * severity — `inferSeverityFromTitle(title, feed.defaultSeverity)` still
 * promotes anything that actually reads "critical" / "important" / "high".
 *
 * It is `medium`, not `high`. At `high`, every routine "Chrome Stable for iOS
 * Update" became a high-severity advisory, which fired `patch.released`, which
 * wrote an alert — the live board was 16 alerts, all vendor release notes, and
 * they filled the top ticker. A release note is not a security event.
 *
 * Consequence worth knowing: both the client watcher and the `patch.released`
 * evaluator require critical|high, so an unmarked routine release now produces
 * NO alert at all. Patch visibility is unaffected — PatchTrackerPanel reads
 * /api/data/patches, which does not filter on severity.
 */
const VENDOR_FEEDS: VendorFeed[] = [
  // Microsoft — MSRC has no clean RSS feed: the blog feed 301-redirects to an
  // HTML page (which breaks the XML parser) and the update guide is a JSON API.
  // Microsoft CVEs surface via NVD/KEV + the @MsftSecIntel X feed instead.
  // Apple — TODO: scrape — Apple does not publish a clean security RSS feed.
  // The collector falls through to DEMO_ADVISORIES for vendor='apple'.
  // Ubuntu USN
  {
    vendor: 'ubuntu',
    name: 'Ubuntu USN',
    url: 'https://ubuntu.com/security/notices/rss.xml',
    defaultSeverity: 'medium',
  },
  // Red Hat — RHSA RSS (the old access.redhat.com/.../rhsa-rss.rss 404s)
  {
    vendor: 'redhat',
    name: 'Red Hat Security Updates',
    url: 'https://www.redhat.com/en/rss/security-updates',
    defaultSeverity: 'medium',
  },
  // Chrome Releases (Google) — includes stable channel security fixes
  {
    vendor: 'chrome',
    name: 'Chrome Releases',
    url: 'https://chromereleases.googleblog.com/feeds/posts/default',
    defaultSeverity: 'medium',
  },
  // Mozilla — MFSA no longer publishes an RSS/Atom feed (the old feed.xml 404s).
  // Firefox / Thunderbird CVEs surface via NVD/KEV instead.
];

// ─── Demo data ───

const DEMO_ADVISORIES: Advisory[] = markFallback(
  withStableAdvisoryIds([
    {
      id: 1,
      advisoryId: 'MSRC-2026-0521-OFFICE',
      issuer: 'vendor',
      issuerGeography: 'us',
      publishedAt: '2026-05-21T18:00:00Z',
      severity: 'critical',
      title: 'Microsoft Office Remote Code Execution Vulnerability',
      summary:
        'Microsoft released security updates addressing a critical RCE flaw in Office (CVE-2026-0142) actively exploited in the wild.',
      affectedCves: ['CVE-2026-0142'],
      affectedProducts: ['Microsoft Office', 'Microsoft 365 Apps'],
      advisoryUrl: 'https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-0142',
    },
    {
      id: 2,
      advisoryId: 'APPLE-HT2026-0518',
      issuer: 'vendor',
      issuerGeography: 'us',
      publishedAt: '2026-05-18T16:00:00Z',
      severity: 'high',
      title: 'About the security content of macOS Sonoma 14.7.6',
      summary:
        'macOS Sonoma 14.7.6 addresses multiple kernel and WebKit vulnerabilities, including two reported as actively exploited.',
      affectedCves: ['CVE-2026-0093', 'CVE-2025-9871'],
      affectedProducts: ['macOS Sonoma'],
      advisoryUrl: 'https://support.apple.com/en-us/HT2026-0518',
    },
    {
      id: 3,
      advisoryId: 'USN-7124-1',
      issuer: 'vendor',
      issuerGeography: 'global',
      publishedAt: '2026-05-20T11:30:00Z',
      severity: 'high',
      title: 'OpenSSL vulnerabilities — Ubuntu Security Notice',
      summary:
        'Multiple vulnerabilities in OpenSSL could result in denial of service or information disclosure.',
      affectedCves: ['CVE-2026-0177', 'CVE-2026-0178'],
      affectedProducts: ['openssl'],
      advisoryUrl: 'https://ubuntu.com/security/notices/USN-7124-1',
    },
    {
      id: 4,
      advisoryId: 'RHSA-2026:2218',
      issuer: 'vendor',
      issuerGeography: 'us',
      publishedAt: '2026-05-19T09:00:00Z',
      severity: 'critical',
      title: 'Important: kernel security update',
      summary:
        'An update for kernel is now available for Red Hat Enterprise Linux 9, addressing a high-impact privilege escalation flaw.',
      affectedCves: ['CVE-2026-0093'],
      affectedProducts: ['Red Hat Enterprise Linux 9'],
      advisoryUrl: 'https://access.redhat.com/errata/RHSA-2026:2218',
    },
    {
      id: 5,
      advisoryId: 'CHROME-126.0.6478.114',
      issuer: 'vendor',
      issuerGeography: 'us',
      publishedAt: '2026-05-22T22:00:00Z',
      severity: 'high',
      title: 'Stable Channel Update for Desktop — 126.0.6478.114',
      summary:
        'The Stable channel has been updated to 126.0.6478.114 for Windows, Mac, and Linux. This update includes 4 security fixes, including 1 rated High.',
      affectedCves: ['CVE-2026-0211'],
      affectedProducts: ['Google Chrome'],
      advisoryUrl: 'https://chromereleases.googleblog.com/2026/05/stable-channel-update.html',
    },
  ]),
);

// ─── Helpers ───

function extractCves(text: string | undefined): string[] {
  if (!text) return [];
  const matches = text.match(CVE_RE);
  if (!matches) return [];
  // Dedupe while preserving first-seen order.
  return Array.from(new Set(matches));
}

/**
 * Promote a release above the feed's `defaultSeverity` floor when its title
 * carries an actual severity rating.
 *
 * Word boundaries, not substrings — the same trap the CERT collector had
 * ("highlights" reading as `high`, "flow" as `low`). This is load-bearing now
 * that the floor is `medium`: a false promotion is the only way a routine
 * release note can start alerting again.
 *
 * Exported for vendor-patches.test.ts.
 */
export function inferSeverityFromTitle(
  title: string | undefined,
  fallback?: CveSeverity,
): CveSeverity {
  if (!title) return fallback ?? 'medium';
  const t = title.toLowerCase();
  const word = (w: string) => new RegExp(`\\b${w}\\b`).test(t);

  if (word('critical')) return 'critical';
  if (word('important') || word('high')) return 'high';
  if (word('moderate') || word('medium')) return 'medium';
  if (word('low')) return 'low';
  return fallback ?? 'medium';
}

function vendorToGeography(vendor: VendorKey): Advisory['issuerGeography'] {
  switch (vendor) {
    case 'ubuntu':
      return 'global';
    case 'mozilla':
      return 'global';
    default:
      return 'us';
  }
}

async function parseVendorFeed(feed: VendorFeed, limit: number): Promise<Advisory[]> {
  try {
    const parsed = await parser.parseString(
      await (await safeFetch(feed.url, {}, 2 * 1024 * 1024)).text(),
    );
    const items = parsed.items ?? [];

    return items.slice(0, limit).map((item) => {
      const title = item.title ?? 'Untitled advisory';
      const summary = item.contentSnippet ?? item.summary ?? item.content ?? '';
      const haystack = `${title}\n${summary}`;
      const cves = extractCves(haystack);

      const advisoryId = createRssAdvisoryId(feed.vendor, {
        guid: item.guid,
        link: item.link,
        title,
      });
      return {
        // Derived from advisoryId, NOT the loop index — see stable-id.ts.
        id: stableNumericId(advisoryId),
        advisoryId,
        issuer: 'vendor',
        issuerGeography: vendorToGeography(feed.vendor),
        publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
        severity: inferSeverityFromTitle(title, feed.defaultSeverity),
        title,
        summary: typeof summary === 'string' ? summary.slice(0, 800) : undefined,
        affectedCves: cves,
        advisoryUrl: item.link ?? feed.url,
      } as Advisory;
    });
  } catch (err) {
    console.warn(
      `[Vendor Patches] Failed to fetch ${feed.name} (${feed.url}):`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

// ─── Public API ───

/**
 * Fetch vendor security advisories. Pass a single vendor to filter; omit for all.
 * Returns DEMO_ADVISORIES on total failure — never throws.
 */
export async function fetchVendorAdvisories(
  vendor?: VendorKey,
  limit: number = 30,
): Promise<Advisory[]> {
  // v2: `id` changed from a positional index to stableNumericId(advisoryId).
  // Cached v1 payloads carry the old scheme, so the key must move with it.
  // v3: defaultSeverity dropped high -> medium, so cached v2 payloads carry
  // the old (noisier) severities.
  // v4: RSS identities keep the full guid/link instead of an 80-char prefix.
  const cacheKey = `patches:vendor:${vendor ?? 'all'}:${limit}:v4`;
  const cached = await getCached<Advisory[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('vendor_patches')) {
    return vendor
      ? DEMO_ADVISORIES.filter((a) => (a.title ?? '').toLowerCase().includes(vendor)).slice(
          0,
          limit,
        )
      : DEMO_ADVISORIES.slice(0, limit);
  }
  if (!checkRateLimit('vendor_patches')) {
    return vendor
      ? DEMO_ADVISORIES.filter((a) => (a.title ?? '').toLowerCase().includes(vendor)).slice(
          0,
          limit,
        )
      : DEMO_ADVISORIES.slice(0, limit);
  }

  const feeds = vendor ? VENDOR_FEEDS.filter((f) => f.vendor === vendor) : VENDOR_FEEDS;

  // If a vendor was requested but no feed exists (e.g., Apple), return demo.
  if (vendor && feeds.length === 0) {
    return DEMO_ADVISORIES.filter((a) => (a.title ?? '').toLowerCase().includes(vendor)).slice(
      0,
      limit,
    );
  }

  try {
    const perFeed = Math.max(5, Math.ceil(limit / Math.max(1, feeds.length)));
    const results = await Promise.allSettled(feeds.map((f) => parseVendorFeed(f, perFeed)));

    const advisories: Advisory[] = [];
    let anyFulfilled = false;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        anyFulfilled = true;
        advisories.push(...r.value);
      }
    }

    // Sort only. The sequential re-id that used to live here was the opposite
    // of stable — it made an advisory's id depend on how many others happened
    // to be in the same response. Ids come from stableNumericId(advisoryId).
    advisories.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );

    if (advisories.length === 0) {
      // Treat zero-result + all-failures as a soft 429 to throttle retries.
      if (!anyFulfilled) setBackoff('vendor_patches', 5 * 60_000);
      return vendor
        ? DEMO_ADVISORIES.filter((a) => (a.title ?? '').toLowerCase().includes(vendor)).slice(
            0,
            limit,
          )
        : DEMO_ADVISORIES.slice(0, limit);
    }

    const trimmed = dedupeAdvisoriesByIdentity(advisories).slice(0, limit);
    await setCache(cacheKey, trimmed);
    return trimmed;
  } catch (err) {
    console.warn('[Vendor Patches] Unexpected failure:', err instanceof Error ? err.message : err);
    return DEMO_ADVISORIES.slice(0, limit);
  }
}

/** Expose for the API route to enumerate supported vendors. */
export function getSupportedVendors(): VendorKey[] {
  // Apple is listed even though we lack RSS — the route returns DEMO data for it.
  return ['microsoft', 'apple', 'ubuntu', 'redhat', 'chrome', 'mozilla'];
}

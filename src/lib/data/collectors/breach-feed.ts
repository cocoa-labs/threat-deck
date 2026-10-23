import { demoData } from '@/lib/data/fallback';
import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * Breach disclosures + national CERT advisory collector.
 *
 * Sources:
 * - Have I Been Pwned (HIBP) public breaches endpoint —
 *   https://haveibeenpwned.com/api/v3/breaches (no key, User-Agent required)
 * - National CERT RSS feeds (CISA, NCSC-UK, ENISA, CERT-EU, JPCERT, ACSC, CCCS)
 *
 * Some CERT feeds are unreliable and fall through to DEMO_ data — those are
 * documented with `// TODO: scrape` comments.
 */

import Parser from 'rss-parser';
import { markFallback } from '@/lib/data/fallback';
import type { Advisory, AdvisoryGeography, BreachDisclosure, CveSeverity } from '@/lib/types';
import { createRssAdvisoryId, dedupeAdvisoriesByIdentity } from '@/lib/utils/advisory-identity';
import { stableNumericId, withStableAdvisoryIds } from '@/lib/utils/stable-id';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from '../rate-limiter';

const HIBP_URL = 'https://haveibeenpwned.com/api/v3/breaches';
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

// ─── CERT feed registry ───

export type CertIssuer = 'cisa' | 'ncsc_uk' | 'enisa' | 'cert_eu' | 'jpcert' | 'acsc' | 'cccs';

interface CertFeed {
  issuer: CertIssuer;
  geography: AdvisoryGeography;
  name: string;
  url: string;
  // Some feeds may 404 — flagged here so we can prefer DEMO seed data.
  flaky?: boolean;
}

const CERT_FEEDS: CertFeed[] = [
  {
    issuer: 'cisa',
    geography: 'us',
    name: 'CISA Cybersecurity Advisories',
    url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml',
  },
  {
    issuer: 'ncsc_uk',
    geography: 'uk',
    name: 'NCSC-UK News',
    url: 'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml',
  },
  // ENISA — RSS reliability is poor; mark as flaky.
  {
    issuer: 'enisa',
    geography: 'eu',
    name: 'ENISA News',
    url: 'https://www.enisa.europa.eu/news/RSS',
    flaky: true,
  },
  {
    issuer: 'cert_eu',
    geography: 'eu',
    name: 'CERT-EU Security Advisories',
    url: 'https://cert.europa.eu/publications/security-advisories/rss',
  },
  {
    issuer: 'jpcert',
    geography: 'jp',
    name: 'JPCERT/CC English RSS',
    url: 'https://www.jpcert.or.jp/english/rss/jpcert-en.rdf',
  },
  // ACSC RSS — endpoint reliability is unknown; flagged flaky.
  // TODO: scrape — confirm RSS availability before relying on it.
  {
    issuer: 'acsc',
    geography: 'au',
    name: 'ACSC Threat Updates',
    url: 'https://www.cyber.gov.au/rssfeed/2',
    flaky: true,
  },
  // CCCS RSS — endpoint reliability is unknown; flagged flaky.
  // TODO: scrape — confirm RSS availability before relying on it.
  {
    issuer: 'cccs',
    geography: 'ca',
    name: 'Canadian Centre for Cyber Security',
    url: 'https://www.cyber.gc.ca/en/rss-news',
    flaky: true,
  },
];

// ─── Demo data ───

const DEMO_BREACHES: BreachDisclosure[] = markFallback([
  {
    id: 1,
    organization: 'Acme Networks',
    disclosedAt: '2026-05-18T00:00:00Z',
    source: 'hibp',
    sourceUrl: 'https://haveibeenpwned.com/PwnedWebsites#Acme',
    breachType: 'Email addresses; Passwords; Usernames',
    recordsCompromised: 32_400_000,
    attestationQuality: 'high',
    notes: 'Acme Networks suffered a credential-stuffing breach exposing 32.4M user records.',
  },
  {
    id: 2,
    organization: 'Nimbus Logistics',
    disclosedAt: '2026-05-15T00:00:00Z',
    source: 'hibp',
    sourceUrl: 'https://haveibeenpwned.com/PwnedWebsites#Nimbus',
    breachType: 'Email addresses; Phone numbers; Physical addresses',
    recordsCompromised: 8_900_000,
    attestationQuality: 'high',
    notes: 'Nimbus Logistics disclosed a third-party vendor breach affecting customer PII.',
  },
  {
    id: 3,
    organization: 'Vertex Health',
    disclosedAt: '2026-05-12T00:00:00Z',
    source: 'hibp',
    sourceUrl: 'https://haveibeenpwned.com/PwnedWebsites#Vertex',
    breachType: 'Email addresses; Passwords',
    recordsCompromised: 1_200_000,
    attestationQuality: 'medium',
    notes: 'Vertex Health portal breach; data appearing for sale on a dark-web forum.',
  },
  {
    id: 4,
    organization: 'Aurora Gaming',
    disclosedAt: '2026-05-09T00:00:00Z',
    source: 'hibp',
    sourceUrl: 'https://haveibeenpwned.com/PwnedWebsites#Aurora',
    breachType: 'Email addresses; Hashed passwords; IP addresses',
    recordsCompromised: 4_500_000,
    attestationQuality: 'high',
    notes: 'Aurora Gaming platform breach attributed to a SQL injection vulnerability.',
  },
  {
    id: 5,
    organization: 'Helix Fitness',
    disclosedAt: '2026-05-05T00:00:00Z',
    source: 'hibp',
    sourceUrl: 'https://haveibeenpwned.com/PwnedWebsites#Helix',
    breachType: 'Email addresses; Names; Encrypted passwords',
    recordsCompromised: 720_000,
    attestationQuality: 'medium',
    notes: 'Helix Fitness app suffered an unauthorized access incident in early Q2 2026.',
  },
]);

const DEMO_CERT_ADVISORIES: Advisory[] = markFallback(
  withStableAdvisoryIds([
    {
      id: 1,
      advisoryId: 'AA26-141A',
      issuer: 'cisa',
      issuerGeography: 'us',
      publishedAt: '2026-05-21T14:00:00Z',
      severity: 'critical',
      title: 'Joint Cybersecurity Advisory: LockBit Ransomware Group Resurgence',
      summary:
        'CISA, FBI, and international partners warn of renewed LockBit activity targeting healthcare and manufacturing sectors.',
      affectedCves: ['CVE-2026-0142', 'CVE-2026-0118'],
      advisoryUrl: 'https://www.cisa.gov/news-events/cybersecurity-advisories/aa26-141a',
    },
    {
      id: 2,
      advisoryId: 'NCSC-2026-0518',
      issuer: 'ncsc_uk',
      issuerGeography: 'uk',
      publishedAt: '2026-05-18T11:30:00Z',
      severity: 'high',
      title: 'NCSC issues guidance on Fortinet FortiManager auth bypass',
      summary:
        'UK organisations should patch immediately or restrict management plane access following active exploitation of CVE-2026-0118.',
      affectedCves: ['CVE-2026-0118'],
      advisoryUrl: 'https://www.ncsc.gov.uk/news/ncsc-2026-0518',
    },
    {
      id: 3,
      advisoryId: 'ENISA-2026-05-15',
      issuer: 'enisa',
      issuerGeography: 'eu',
      publishedAt: '2026-05-15T09:00:00Z',
      severity: 'medium',
      title: 'ENISA Threat Landscape mid-year update',
      summary:
        'ENISA publishes mid-year update on EU cybersecurity threat trends, highlighting ransomware and supply chain attacks.',
      advisoryUrl: 'https://www.enisa.europa.eu/news/enisa-2026-05-15',
    },
    {
      id: 4,
      advisoryId: 'JPCERT-2026-AT-2210',
      issuer: 'jpcert',
      issuerGeography: 'jp',
      publishedAt: '2026-05-13T05:00:00Z',
      severity: 'high',
      title: 'JPCERT/CC alerts on Apache HTTP Server vulnerability',
      summary:
        'JPCERT/CC issues advisory regarding active exploitation of CVE-2026-0142 in Japan-hosted environments.',
      affectedCves: ['CVE-2026-0142'],
      advisoryUrl: 'https://www.jpcert.or.jp/english/at/2026/at260014.html',
    },
    {
      id: 5,
      advisoryId: 'ACSC-2026-007',
      issuer: 'acsc',
      issuerGeography: 'au',
      publishedAt: '2026-05-10T22:00:00Z',
      severity: 'high',
      title: 'ACSC: Mitigation guidance for critical infrastructure operators',
      summary:
        'ACSC publishes updated mitigation guidance for Australian critical infrastructure operators in response to ongoing campaigns.',
      advisoryUrl: 'https://www.cyber.gov.au/about-us/view-all-content/alerts/acsc-2026-007',
    },
  ]),
);

// ─── HIBP response shape ───

interface HibpBreach {
  Name?: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  AddedDate?: string;
  PwnCount?: number;
  Description?: string;
  DataClasses?: string[];
  IsVerified?: boolean;
  IsSensitive?: boolean;
  IsRetired?: boolean;
  IsFabricated?: boolean;
}

// ─── Helpers ───

function extractCves(text: string | undefined): string[] {
  if (!text) return [];
  const matches = text.match(CVE_RE);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

/**
 * Collocations where "critical" is describing an ASSET, not a severity rating.
 * The NCSC-UK source is the org's news feed, so routine editorial copy —
 * "…affecting the UK's critical systems", "urge critical sectors to improve
 * defences" — used to score `critical` on a bare substring match and fire a
 * critical patch alert. Two such headlines in one poll is exactly how the
 * operator ended up with two near-identical "this isn't a software patch"
 * toasts.
 */
const CRITICAL_AS_ASSET =
  /\bcritical\s+(national\s+)?(infrastructure|infrastructures|sector|sectors|system|systems|service|services|asset|assets|function|functions|supplier|suppliers|network|networks)\b/;

/** Severity words only count as ratings on a word boundary. */
const SEVERITY_WORD = (word: string) => new RegExp(`\\b${word}\\b`);

export function inferSeverityFromTitle(title: string | undefined): CveSeverity {
  if (!title) return 'medium';
  const t = title.toLowerCase();

  // Strip the asset-sense uses before looking for a rating, so a headline can
  // still be genuinely critical AND mention critical infrastructure.
  const rated = t.replace(new RegExp(CRITICAL_AS_ASSET, 'g'), ' ');

  if (SEVERITY_WORD('critical').test(rated)) return 'critical';
  if (SEVERITY_WORD('high').test(t) || SEVERITY_WORD('important').test(t)) return 'high';
  if (SEVERITY_WORD('low').test(t)) return 'low';
  return 'medium';
}

// ─── Public API ───

/**
 * Fetch all public breaches from HIBP, mapped to BreachDisclosure.
 * Returns DEMO on failure — never throws.
 */
export async function fetchHibpBreaches(limit: number = 100): Promise<BreachDisclosure[]> {
  // v2: `id` changed from a positional index to stableNumericId, and each row
  // now carries `organization`. Bump so Redis can't serve the old shape.
  const cacheKey = `breach:hibp:${limit}:v2`;
  const cached = await getCached<BreachDisclosure[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('hibp')) return demoData(DEMO_BREACHES).slice(0, limit);
  if (!checkRateLimit('hibp')) return demoData(DEMO_BREACHES).slice(0, limit);

  try {
    const res = await fetchWithTimeout(HIBP_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
    });

    if (res.status === 429) {
      setBackoff('hibp', 15 * 60_000);
      return demoData(DEMO_BREACHES).slice(0, limit);
    }
    if (!res.ok) {
      console.warn(`[Breach] HIBP returned ${res.status}`);
      return demoData(DEMO_BREACHES).slice(0, limit);
    }

    const raw = (await res.json()) as HibpBreach[];
    if (!Array.isArray(raw) || raw.length === 0) {
      return demoData(DEMO_BREACHES).slice(0, limit);
    }

    const breaches: BreachDisclosure[] = raw.map((b) => {
      const dataClasses = (b.DataClasses ?? []).join('; ');
      const sourceUrl = b.Name
        ? `https://haveibeenpwned.com/PwnedWebsites#${b.Name}`
        : 'https://haveibeenpwned.com/PwnedWebsites';
      return {
        // Stable content id, NOT the array index. A positional `idx + 1` shifts
        // whenever HIBP inserts/reorders a breach ahead of others (its list is
        // name-ordered), so unchanged breaches looked "new" to the activation
        // diff and fired phantom breach.disclosed alerts. Mirrors the advisory
        // fix (withStableAdvisoryIds).
        id: stableNumericId(b.Name ?? b.Domain ?? sourceUrl),
        // Real org name — HIBP's display Title, falling back to the slug Name.
        organization: b.Title ?? b.Name,
        disclosedAt: b.BreachDate ?? b.AddedDate ?? new Date().toISOString(),
        source: 'hibp',
        sourceUrl,
        breachType: dataClasses || undefined,
        recordsCompromised: b.PwnCount,
        attestationQuality: b.IsVerified ? 'high' : 'medium',
        notes: b.Description
          ? // HIBP descriptions are HTML; strip tags crudely for our card UI.
            b.Description.replace(/<[^>]+>/g, '')
              .replace(/[<>]/g, '')
              .slice(0, 600)
          : undefined,
      };
    });

    breaches.sort((a, b) => new Date(b.disclosedAt).getTime() - new Date(a.disclosedAt).getTime());
    const trimmed = breaches.slice(0, limit);

    await setCache(cacheKey, trimmed);
    return trimmed;
  } catch (err) {
    console.warn('[Breach] HIBP fetch failed:', err instanceof Error ? err.message : err);
    return demoData(DEMO_BREACHES).slice(0, limit);
  }
}

async function parseCertFeed(feed: CertFeed, limit: number): Promise<Advisory[]> {
  // Flaky feeds: try, but failure is silent — demo data backfills downstream.
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

      const advisoryId = createRssAdvisoryId(feed.issuer, {
        guid: item.guid,
        link: item.link,
        title,
      });
      return {
        // Derived from advisoryId, NOT the loop index — see stable-id.ts.
        id: stableNumericId(advisoryId),
        advisoryId,
        issuer: feed.issuer,
        issuerGeography: feed.geography,
        publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
        severity: inferSeverityFromTitle(title),
        title,
        summary: typeof summary === 'string' ? summary.slice(0, 800) : undefined,
        affectedCves: cves,
        advisoryUrl: item.link ?? feed.url,
      } as Advisory;
    });
  } catch (err) {
    if (!feed.flaky) {
      console.warn(
        `[CERT] Failed to fetch ${feed.name} (${feed.url}):`,
        err instanceof Error ? err.message : err,
      );
    }
    return [];
  }
}

/**
 * Fetch CERT advisories. Pass a single issuer to filter; omit for all.
 * Returns DEMO on failure — never throws.
 */
export async function fetchCertAdvisories(
  issuer?: CertIssuer,
  limit: number = 30,
): Promise<Advisory[]> {
  // v2: `id` changed from a positional index to stableNumericId(advisoryId).
  // Cached v1 payloads carry the old scheme, so the key must move with it.
  // v3: RSS identities keep the full guid/link instead of an 80-char prefix.
  const cacheKey = `cert:advisories:${issuer ?? 'all'}:${limit}:v3`;
  const cached = await getCached<Advisory[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('cert_advisories')) {
    return issuer
      ? demoData(DEMO_CERT_ADVISORIES)
          .filter((a) => a.issuer === issuer)
          .slice(0, limit)
      : demoData(DEMO_CERT_ADVISORIES).slice(0, limit);
  }
  if (!checkRateLimit('cert_advisories')) {
    return issuer
      ? demoData(DEMO_CERT_ADVISORIES)
          .filter((a) => a.issuer === issuer)
          .slice(0, limit)
      : demoData(DEMO_CERT_ADVISORIES).slice(0, limit);
  }

  const feeds = issuer ? CERT_FEEDS.filter((f) => f.issuer === issuer) : CERT_FEEDS;
  if (feeds.length === 0) {
    return issuer
      ? demoData(DEMO_CERT_ADVISORIES)
          .filter((a) => a.issuer === issuer)
          .slice(0, limit)
      : demoData(DEMO_CERT_ADVISORIES).slice(0, limit);
  }

  try {
    const perFeed = Math.max(5, Math.ceil(limit / Math.max(1, feeds.length)));
    const results = await Promise.allSettled(feeds.map((f) => parseCertFeed(f, perFeed)));

    const advisories: Advisory[] = [];
    let anyFulfilled = false;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        anyFulfilled = true;
        advisories.push(...r.value);
      }
    }

    // Sort only — the sequential re-id that used to follow made an advisory's
    // id depend on how many others shared its response. Ids come from
    // stableNumericId(advisoryId) in parseCertFeed.
    advisories.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );

    if (advisories.length === 0) {
      if (!anyFulfilled) setBackoff('cert_advisories', 5 * 60_000);
      return issuer
        ? demoData(DEMO_CERT_ADVISORIES)
            .filter((a) => a.issuer === issuer)
            .slice(0, limit)
        : demoData(DEMO_CERT_ADVISORIES).slice(0, limit);
    }

    const trimmed = dedupeAdvisoriesByIdentity(advisories).slice(0, limit);
    await setCache(cacheKey, trimmed);
    return trimmed;
  } catch (err) {
    console.warn('[CERT] Unexpected failure:', err instanceof Error ? err.message : err);
    return demoData(DEMO_CERT_ADVISORIES).slice(0, limit);
  }
}

/** Supported CERT issuers (for API route enumeration). */
export function getSupportedCertIssuers(): CertIssuer[] {
  return ['cisa', 'ncsc_uk', 'enisa', 'cert_eu', 'jpcert', 'acsc', 'cccs'];
}

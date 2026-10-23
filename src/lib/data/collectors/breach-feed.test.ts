/**
 * Tests for CERT-advisory severity inference.
 *
 * The NCSC-UK source registered in this collector is the organisation's NEWS
 * feed, so ordinary editorial copy flows through `parseCertFeed` as an
 * `Advisory`. A bare `title.includes('critical')` scored those posts as
 * critical, which fired a critical patch alert, which made the agent open with
 * "This isn't a software patch" — twice in one poll, which is the duplication
 * the operator reported.
 *
 * The two headlines below are the exact ones that misfired.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stableNumericId } from '@/lib/utils/stable-id';
import { fetchHibpBreaches, inferSeverityFromTitle } from './breach-feed';

// Force the collector through predictable branches without Redis or the
// network: getCached always misses; isBackedOff is toggled per-test to pick the
// demo-fallback path vs the live-fetch path.
const rateLimiterMock = vi.hoisted(() => ({
  getCached: vi.fn(async () => null),
  isBackedOff: vi.fn(() => false),
  checkRateLimit: vi.fn(() => true),
  setBackoff: vi.fn(),
  setCache: vi.fn(async () => {}),
}));
vi.mock('../rate-limiter', () => rateLimiterMock);

describe('inferSeverityFromTitle', () => {
  it('does not treat "critical <asset>" editorial copy as a critical rating', () => {
    expect(
      inferSeverityFromTitle(
        "NCSC CEO: Hostile states linked to three-quarters of cyber attacks affecting UK's critical systems",
      ),
    ).not.toBe('critical');

    expect(
      inferSeverityFromTitle(
        'UK and Allies urge critical sectors to improve defences against Russian intelligence targeting',
      ),
    ).not.toBe('critical');
  });

  it('covers the other asset-sense collocations', () => {
    for (const title of [
      'Guidance for critical national infrastructure operators',
      'Protecting critical services from ransomware',
      'Advice for critical suppliers',
      'Securing critical networks',
      'Report on critical infrastructure resilience',
    ]) {
      expect(inferSeverityFromTitle(title), title).not.toBe('critical');
    }
  });

  it('still recognises a genuine critical rating', () => {
    expect(inferSeverityFromTitle('Critical vulnerability in Ivanti Connect Secure')).toBe(
      'critical',
    );
    expect(inferSeverityFromTitle('AA24-100A: Critical severity advisory')).toBe('critical');
  });

  it('recognises a genuine critical rating even alongside asset-sense copy', () => {
    // The asset phrase is stripped before the rating is looked for, so a real
    // rating in the same headline still lands.
    expect(
      inferSeverityFromTitle(
        'Critical vulnerability exploited against critical national infrastructure',
      ),
    ).toBe('critical');
  });

  it('requires word boundaries so substrings do not score', () => {
    // "highlights" must not read as `high`; "flow" must not read as `low`.
    expect(inferSeverityFromTitle('NCSC highlights supply chain trends')).toBe('medium');
    expect(inferSeverityFromTitle('Data flow guidance for operators')).toBe('medium');
  });

  it('keeps the remaining ratings', () => {
    expect(inferSeverityFromTitle('High severity flaw in Apache')).toBe('high');
    expect(inferSeverityFromTitle('Important update for Exchange')).toBe('high');
    expect(inferSeverityFromTitle('Low impact issue in libfoo')).toBe('low');
    expect(inferSeverityFromTitle('Weekly threat report')).toBe('medium');
    expect(inferSeverityFromTitle(undefined)).toBe('medium');
  });
});

describe('fetchHibpBreaches', () => {
  beforeEach(() => vi.stubEnv('ENABLE_DEMO_DATA', 'true'));
  afterEach(() => {
    rateLimiterMock.isBackedOff.mockReturnValue(false);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('serves demo breaches tagged isFallback so the activation watcher can skip them', async () => {
    // Backed off → the collector returns DEMO_BREACHES without any fetch.
    rateLimiterMock.isBackedOff.mockReturnValue(true);

    const breaches = await fetchHibpBreaches(5);

    expect(breaches.length).toBeGreaterThan(0);
    // Every demo row must be tagged — this is the flag the breach.disclosed
    // watcher gates on so a HIBP outage can't fire fabricated alerts.
    expect(breaches.every((b) => b.isFallback === true)).toBe(true);
  });

  it('gives every demo breach a real organization name (never org_unknown)', async () => {
    rateLimiterMock.isBackedOff.mockReturnValue(true);

    const breaches = await fetchHibpBreaches(5);

    expect(
      breaches.every((b) => typeof b.organization === 'string' && b.organization.length > 0),
    ).toBe(true);
    expect(breaches.map((b) => b.organization)).toContain('Nimbus Logistics');
  });

  it('assigns real breaches a STABLE content id (not the array index) and carries the org name', async () => {
    rateLimiterMock.isBackedOff.mockReturnValue(false);
    // Two breaches whose ARRAY ORDER differs from a positional id — the old
    // `idx + 1` would have given them 1 and 2; the fix keys off Name.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => [
          {
            Name: 'Nimbus',
            Title: 'Nimbus Logistics',
            BreachDate: '2026-05-15',
            PwnCount: 8_900_000,
            IsVerified: true,
          },
          {
            Name: 'Acme',
            Title: 'Acme Networks',
            BreachDate: '2026-05-18',
            PwnCount: 32_400_000,
            IsVerified: true,
          },
        ],
      })),
    );

    const breaches = await fetchHibpBreaches(10);
    const nimbus = breaches.find((b) => b.organization === 'Nimbus Logistics');
    const acme = breaches.find((b) => b.organization === 'Acme Networks');

    expect(nimbus).toBeDefined();
    expect(acme).toBeDefined();
    // id is the content hash of the HIBP Name, identical across polls regardless
    // of position — this is what stops list churn from manufacturing "new" rows.
    expect(nimbus?.id).toBe(stableNumericId('Nimbus'));
    expect(acme?.id).toBe(stableNumericId('Acme'));
    // Real fetch path must NOT be tagged fallback.
    expect(breaches.every((b) => !b.isFallback)).toBe(true);
  });
});

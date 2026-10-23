import { describe, expect, it } from 'vitest';
import type { Advisory } from '@/lib/types';
import {
  advisoryIdentityKey,
  createRssAdvisoryId,
  dedupeAdvisoriesByIdentity,
} from './advisory-identity';
import { stableNumericId } from './stable-id';

const COLLIDING_CHROME_URLS = [
  'http://chromereleases.googleblog.com/2026/07/stable-channel-update-for-desktop_0887107924.html',
  'http://chromereleases.googleblog.com/2026/07/stable-channel-update-for-desktop_01320465736.html',
  'http://chromereleases.googleblog.com/2026/07/long-term-support-channel-update-for_030076835.html',
  'http://chromereleases.googleblog.com/2026/07/long-term-support-channel-update-for_01808936655.html',
] as const;

function chromeAdvisory(url: string, index: number): Advisory {
  const advisoryId = createRssAdvisoryId('chrome', { guid: url });
  return {
    id: stableNumericId(advisoryId),
    advisoryId,
    issuer: 'vendor',
    publishedAt: `2026-07-${String(29 - index).padStart(2, '0')}T00:00:00Z`,
    title: index < 2 ? 'Stable Channel Update for Desktop' : 'Long Term Support Channel Update',
    advisoryUrl: url,
  };
}

describe('RSS advisory identity', () => {
  it('keeps complete source identities in guid → link → title order', () => {
    const longGuid = COLLIDING_CHROME_URLS[0];
    expect(
      createRssAdvisoryId('chrome', {
        guid: longGuid,
        link: 'https://example.com/link',
        title: 'Fallback title',
      }),
    ).toBe(`chrome-${longGuid}`);
    expect(createRssAdvisoryId('cisa', { link: 'https://example.com/link' })).toBe(
      'cisa-https://example.com/link',
    );
    expect(createRssAdvisoryId('cisa', { title: 'Fallback title' })).toBe('cisa-Fallback title');
  });

  it('distinguishes the Chrome releases that shared the old 80-character prefixes', () => {
    const advisories = COLLIDING_CHROME_URLS.map(chromeAdvisory);

    expect(new Set(advisories.map((a) => a.advisoryId)).size).toBe(advisories.length);
    expect(new Set(advisories.map((a) => a.id)).size).toBe(advisories.length);
    // PatchTracker React keys and activation keys both use this helper.
    expect(new Set(advisories.map(advisoryIdentityKey)).size).toBe(advisories.length);
  });

  it('deduplicates an exact canonical advisory while preserving similar releases', () => {
    const advisories = COLLIDING_CHROME_URLS.map(chromeAdvisory);
    const duplicate = { ...advisories[0], title: 'Duplicate transport copy' } as Advisory;
    const deduped = dedupeAdvisoriesByIdentity([duplicate, ...advisories]);

    expect(deduped).toHaveLength(advisories.length);
    expect(deduped[0]?.title).toBe('Duplicate transport copy');
    expect(new Set(deduped.map(advisoryIdentityKey)).size).toBe(deduped.length);
  });

  it('uses advisory id, then URL, then a stable legacy composite', () => {
    const base: Advisory = {
      id: 42,
      advisoryId: 'USN-1',
      issuer: 'vendor',
      publishedAt: '2026-07-30T00:00:00Z',
      advisoryUrl: 'https://example.com/usn-1',
    };

    expect(advisoryIdentityKey(base)).toBe('advisory:USN-1');
    expect(advisoryIdentityKey({ ...base, advisoryId: undefined })).toBe(
      'url:https://example.com/usn-1',
    );
    expect(advisoryIdentityKey({ ...base, advisoryId: undefined, advisoryUrl: undefined })).toBe(
      'legacy:vendor:42:2026-07-30T00:00:00Z',
    );
  });
});

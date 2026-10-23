/**
 * Tests for deterministic advisory ids.
 *
 * `Advisory.id` used to be a positional index, assigned three separate times:
 * `id: idx` in each collector's map, a sequential re-id after sorting, and a
 * third re-id in the /api/data/advisories merge branch. So the same advisory
 * carried a different id on every poll and a different id per endpoint — while
 * being used as a React key and a ticker item id.
 */

import { describe, expect, it } from 'vitest';
import { stableNumericId, withStableAdvisoryIds } from './stable-id';

describe('stableNumericId', () => {
  it('is deterministic — the same key always yields the same id', () => {
    expect(stableNumericId('cisa-aa26-141a')).toBe(stableNumericId('cisa-aa26-141a'));
  });

  it('distinguishes different keys', () => {
    expect(stableNumericId('cisa-aa26-141a')).not.toBe(stableNumericId('cisa-aa26-141b'));
    expect(stableNumericId('chrome-1')).not.toBe(stableNumericId('ubuntu-1'));
  });

  it('is always positive — a negative id reads as corrupt downstream', () => {
    for (const key of ['a', 'zzzzzzzzzzzz', 'ncsc_uk-https://www.ncsc.gov.uk/news/x', '']) {
      expect(stableNumericId(key), key).toBeGreaterThan(0);
    }
  });

  it('does not collide across a realistic advisory-id corpus', () => {
    const keys: string[] = [];
    for (const issuer of ['cisa', 'ncsc_uk', 'jpcert', 'chrome', 'ubuntu', 'redhat']) {
      for (let i = 0; i < 200; i++) {
        keys.push(`${issuer}-https://example.org/advisory/${i}`);
      }
    }
    const ids = new Set(keys.map(stableNumericId));
    expect(ids.size).toBe(keys.length);
  });
});

describe('withStableAdvisoryIds', () => {
  const items = [
    { id: 1, advisoryId: 'cisa-aa26-1', title: 'A' },
    { id: 2, advisoryId: 'chrome-2', title: 'B' },
  ];

  it('replaces positional ids with ones derived from advisoryId', () => {
    const stamped = withStableAdvisoryIds(items);
    expect(stamped[0]?.id).toBe(stableNumericId('cisa-aa26-1'));
    expect(stamped[1]?.id).toBe(stableNumericId('chrome-2'));
  });

  it('is order-independent — the same item keeps its id after a re-sort', () => {
    const forward = withStableAdvisoryIds(items);
    const reversed = withStableAdvisoryIds([...items].reverse());
    const byAdvisoryId = (list: typeof forward, key: string) =>
      list.find((i) => i.advisoryId === key)?.id;

    expect(byAdvisoryId(reversed, 'cisa-aa26-1')).toBe(byAdvisoryId(forward, 'cisa-aa26-1'));
    expect(byAdvisoryId(reversed, 'chrome-2')).toBe(byAdvisoryId(forward, 'chrome-2'));
  });

  it('is stable when the surrounding response grows — the positional-id failure', () => {
    const bigger = withStableAdvisoryIds([
      { id: 1, advisoryId: 'brand-new', title: 'New' },
      ...items,
    ]);
    expect(bigger.find((i) => i.advisoryId === 'cisa-aa26-1')?.id).toBe(
      stableNumericId('cisa-aa26-1'),
    );
  });

  it('falls back to url then title when advisoryId is absent', () => {
    const [byUrl, byTitle] = withStableAdvisoryIds([
      { id: 9, advisoryUrl: 'https://example.org/a', title: 'ignored' },
      { id: 9, title: 'Only a title' },
    ]);
    expect(byUrl?.id).toBe(stableNumericId('https://example.org/a'));
    expect(byTitle?.id).toBe(stableNumericId('Only a title'));
  });

  it('does not mutate the input', () => {
    const input = [{ id: 1, advisoryId: 'cisa-x' }];
    withStableAdvisoryIds(input);
    expect(input[0]?.id).toBe(1);
  });
});

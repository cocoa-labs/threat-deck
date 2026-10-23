import { describe, expect, it } from 'vitest';
import { markFallback } from './fallback';

describe('markFallback', () => {
  it('stamps isFallback: true on every item', () => {
    const tagged = markFallback([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(tagged.every((t) => t.isFallback === true)).toBe(true);
  });

  it('preserves every original field', () => {
    const [row] = markFallback([{ id: 7, name: 'Acme', nested: { a: 1 } }]);
    expect(row).toMatchObject({ id: 7, name: 'Acme', nested: { a: 1 }, isFallback: true });
  });

  it('does not mutate the input array or its items', () => {
    const input = [{ id: 1 }];
    const out = markFallback(input);
    expect(input[0]).not.toHaveProperty('isFallback');
    expect(out[0]).not.toBe(input[0]);
  });

  it('returns an empty array unchanged for empty input', () => {
    expect(markFallback([])).toEqual([]);
  });
});

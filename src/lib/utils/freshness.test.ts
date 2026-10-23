import { describe, expect, it } from 'vitest';
import { freshnessFromAge, resolvePanelFreshness } from './freshness';

describe('freshnessFromAge', () => {
  const opts = { liveMs: 1000, staleMs: 5000 };

  it('classifies zero age as live', () => {
    expect(freshnessFromAge(0, opts)).toBe('live');
  });

  it('classifies mid-range age as delayed', () => {
    expect(freshnessFromAge(3000, opts)).toBe('delayed');
  });

  it('classifies old age as stale', () => {
    expect(freshnessFromAge(9000, opts)).toBe('stale');
  });

  it('treats the live boundary (=== liveMs) as live', () => {
    expect(freshnessFromAge(1000, opts)).toBe('live');
  });

  it('treats just past the live boundary as delayed', () => {
    expect(freshnessFromAge(1001, opts)).toBe('delayed');
  });

  it('treats the stale boundary (=== staleMs) as delayed', () => {
    expect(freshnessFromAge(5000, opts)).toBe('delayed');
  });

  it('treats just past the stale boundary as stale', () => {
    expect(freshnessFromAge(5001, opts)).toBe('stale');
  });
});

describe('resolvePanelFreshness', () => {
  const opts = { liveMs: 1000, staleMs: 5000 };

  it('returns demo when demo is true, even with a fresh ageMs', () => {
    expect(resolvePanelFreshness({ demo: true, ageMs: 0, ...opts })).toBe('demo');
  });

  it('returns stale when degraded is true, even with a fresh ageMs', () => {
    expect(resolvePanelFreshness({ degraded: true, ageMs: 0, ...opts })).toBe('stale');
  });

  it('prefers demo over degraded when both are set', () => {
    expect(resolvePanelFreshness({ demo: true, degraded: true, ageMs: 0, ...opts })).toBe('demo');
  });

  it('falls through to the time-based class when neither flag is set', () => {
    expect(resolvePanelFreshness({ ageMs: 0, ...opts })).toBe('live');
    expect(resolvePanelFreshness({ ageMs: 3000, ...opts })).toBe('delayed');
    expect(resolvePanelFreshness({ ageMs: 9000, ...opts })).toBe('stale');
  });

  it('returns undefined when ageMs is null (no successful fetch yet)', () => {
    expect(resolvePanelFreshness({ ageMs: null, ...opts })).toBeUndefined();
  });

  it('returns undefined when ageMs is negative', () => {
    expect(resolvePanelFreshness({ ageMs: -1, ...opts })).toBeUndefined();
  });

  it('still honors demo when ageMs is null', () => {
    expect(resolvePanelFreshness({ demo: true, ageMs: null, ...opts })).toBe('demo');
  });
});

import { describe, expect, it } from 'vitest';
import { selectAdvisoryAlerts, selectNewsAlerts } from './use-activation-events';

// Guards the AI+cyber news alert's anti-spam core. The legacy IWM toast storm
// came from exactly this class of bug — a missing relevance gate + dedup that
// let the same event re-fire. These tests lock in: threshold, dedup, recency
// cutoff, ordering, and the per-tick cap.

type Candidate = { id: string; aiRelevance?: number; publishedAt: string };

const item = (id: string, aiRelevance: number | undefined, publishedAt: string): Candidate => ({
  id,
  aiRelevance,
  publishedAt,
});

// A cutoff before every fixture timestamp, so the recency gate is a no-op for
// the tests that aren't specifically exercising it.
const ANY_TIME = Date.parse('2026-01-01T00:00:00Z');

describe('selectNewsAlerts', () => {
  const none = new Set<string>();

  it('keeps only items at or above the relevance threshold (absent score = 0)', () => {
    const items = [
      item('a', 0.9, '2026-06-05T10:00:00Z'),
      item('b', 0.59, '2026-06-05T10:00:00Z'),
      item('c', undefined, '2026-06-05T10:00:00Z'),
      item('d', 0.6, '2026-06-05T10:00:00Z'),
    ];
    const picked = selectNewsAlerts(items, none, 0.6, 10, ANY_TIME).map((n) => n.id);
    expect(picked.sort()).toEqual(['a', 'd']);
  });

  it('excludes already-seen story ids — fires once per story', () => {
    const items = [item('a', 0.9, '2026-06-05T10:00:00Z'), item('b', 0.9, '2026-06-05T11:00:00Z')];
    const seen = new Set(['a']);
    expect(selectNewsAlerts(items, seen, 0.6, 10, ANY_TIME).map((n) => n.id)).toEqual(['b']);
  });

  it('ignores stories published at or before the watch-start cutoff (no backlog burst)', () => {
    const cutoff = Date.parse('2026-06-05T10:00:00Z');
    const items = [
      item('before', 0.9, '2026-06-05T09:59:00Z'),
      item('at', 0.9, '2026-06-05T10:00:00Z'),
      item('after', 0.9, '2026-06-05T10:01:00Z'),
    ];
    expect(selectNewsAlerts(items, none, 0.6, 10, cutoff).map((n) => n.id)).toEqual(['after']);
  });

  it('returns newest stories first', () => {
    const items = [
      item('old', 0.9, '2026-06-05T08:00:00Z'),
      item('new', 0.9, '2026-06-05T12:00:00Z'),
      item('mid', 0.9, '2026-06-05T10:00:00Z'),
    ];
    expect(selectNewsAlerts(items, none, 0.6, 10, ANY_TIME).map((n) => n.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('caps alerts per tick so a full feed cannot burst', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item(`s${i}`, 0.9, `2026-06-05T1${i}:00:00Z`),
    );
    const picked = selectNewsAlerts(items, none, 0.6, 2, ANY_TIME);
    expect(picked).toHaveLength(2);
    // The two newest survive the cap.
    expect(picked.map((n) => n.id)).toEqual(['s7', 's6']);
  });

  it('returns nothing when every story is below threshold', () => {
    const items = [item('a', 0.1, '2026-06-05T10:00:00Z'), item('b', 0.4, '2026-06-05T11:00:00Z')];
    expect(selectNewsAlerts(items, none, 0.6, 10, ANY_TIME)).toEqual([]);
  });
});

/**
 * The advisory watcher had none of the news watcher's guards, and it showed:
 * two NCSC items about the same story landed in one poll and produced two
 * near-identical agent toasts. These lock in all three guards.
 */
describe('selectAdvisoryAlerts', () => {
  const adv = (id: string, severity: string, publishedAt: string) => ({
    advisoryId: id,
    severity,
    publishedAt,
  });
  const key = (a: { advisoryId: string }) => a.advisoryId;
  const fresh = () => new Set<string>();
  const ANY = 0;

  it('caps at one per tick — two advisories in one poll is the exact bug', () => {
    const items = [
      adv('ncsc-a', 'critical', '2026-07-22T20:00:00Z'),
      adv('ncsc-b', 'critical', '2026-07-22T20:01:00Z'),
      adv('ncsc-c', 'high', '2026-07-22T20:02:00Z'),
    ];
    const picked = selectAdvisoryAlerts(items, key, fresh(), ANY);
    expect(picked).toHaveLength(1);
    // The newest wins the single slot.
    expect(key(picked[0] as { advisoryId: string })).toBe('ncsc-c');
  });

  it('never re-fires a key already seen this session', () => {
    const items = [adv('ncsc-a', 'critical', '2026-07-22T20:00:00Z')];
    const seen = new Set(['ncsc-a']);
    expect(selectAdvisoryAlerts(items, key, seen, ANY)).toEqual([]);
  });

  it('survives a wholesale slice rewrite that makes old items look new', () => {
    // The original case was two hooks clobbering one slice; the slices are
    // separate now, but any wholesale rewrite (refetch, remount, reordered
    // feed) can still make an item disappear and reappear. A prev-tick diff
    // would call that "new" again; the session set does not.
    const a = adv('ncsc-a', 'critical', '2026-07-22T20:00:00Z');
    const seen = fresh();
    for (const item of selectAdvisoryAlerts([a], key, seen, ANY)) seen.add(key(item));
    // slice flips to vendor-only, then back
    expect(selectAdvisoryAlerts([], key, seen, ANY)).toEqual([]);
    expect(selectAdvisoryAlerts([a], key, seen, ANY)).toEqual([]);
  });

  it('ignores the backlog that predates the watcher mounting', () => {
    const cutoff = new Date('2026-07-22T20:00:00Z').getTime();
    const items = [
      adv('old', 'critical', '2026-07-22T19:00:00Z'),
      adv('new', 'critical', '2026-07-22T21:00:00Z'),
    ];
    expect(selectAdvisoryAlerts(items, key, fresh(), cutoff).map(key)).toEqual(['new']);
  });

  it('only fires on critical or high', () => {
    const items = [
      adv('med', 'medium', '2026-07-22T21:00:00Z'),
      adv('low', 'low', '2026-07-22T21:01:00Z'),
    ];
    expect(selectAdvisoryAlerts(items, key, fresh(), ANY)).toEqual([]);
  });
});

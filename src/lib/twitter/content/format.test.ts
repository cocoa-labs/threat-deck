/**
 * Pure unit tests for Phase 9.4 formatting helpers. No DB, no LLM.
 */

import { describe, expect, it } from 'vitest';
import {
  appendCanonicalHashtag,
  DEFAULT_HASHTAG,
  severityWeight,
  TWITTER_MAX_LENGTH,
  TWITTER_URL_BUDGET,
  truncateToTwitter,
  validateThreadDraft,
} from './format';

describe('truncateToTwitter', () => {
  it('passes short text through unchanged', () => {
    expect(truncateToTwitter('hello world')).toBe('hello world');
  });

  it('truncates with ellipsis when text exceeds budget', () => {
    const long = 'a'.repeat(300);
    const out = truncateToTwitter(long);
    expect(out.length).toBeLessThanOrEqual(TWITTER_MAX_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });

  it('reserves room for a URL when provided', () => {
    const long = 'a'.repeat(300);
    const out = truncateToTwitter(long, { room: TWITTER_URL_BUDGET });
    expect(out.length).toBeLessThanOrEqual(TWITTER_MAX_LENGTH - TWITTER_URL_BUDGET);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles room equal to or larger than the budget', () => {
    // Edge: room consumes everything — still returns a usable string
    const out = truncateToTwitter('x', { room: TWITTER_MAX_LENGTH });
    expect(out).toBe('…');
  });

  it('is idempotent on already-fit text with room', () => {
    const fitted = 'short text';
    expect(truncateToTwitter(fitted, { room: 23 })).toBe(fitted);
  });
});

describe('appendCanonicalHashtag', () => {
  it('appends the hashtag when missing', () => {
    expect(appendCanonicalHashtag('hello')).toBe('hello #AICyber');
  });

  it('is idempotent when the hashtag is already present', () => {
    expect(appendCanonicalHashtag('hello #AICyber')).toBe('hello #AICyber');
    expect(appendCanonicalHashtag('#AICyber leads the tweet')).toBe('#AICyber leads the tweet');
  });

  it('does not match a hashtag inside another word', () => {
    // "#AICyber" is the canonical; "#AICyberDefense" is a different tag
    expect(appendCanonicalHashtag('hello #AICyberDefense')).toBe('hello #AICyberDefense #AICyber');
  });

  it('honors a custom hashtag', () => {
    expect(appendCanonicalHashtag('hello', '#PromptInjection')).toBe('hello #PromptInjection');
  });
});

describe('severityWeight', () => {
  it('ranks critical > high > medium > low', () => {
    expect(severityWeight('critical')).toBeGreaterThan(severityWeight('high'));
    expect(severityWeight('high')).toBeGreaterThan(severityWeight('medium'));
    expect(severityWeight('medium')).toBeGreaterThan(severityWeight('low'));
  });

  it('returns 0.5 for unknown or null severity', () => {
    expect(severityWeight('info')).toBe(0.5);
    expect(severityWeight(null)).toBe(0.5);
    expect(severityWeight(undefined)).toBe(0.5);
  });
});

describe('validateThreadDraft', () => {
  const goodTweet = { text: `Hello AI Cyber Wire ${DEFAULT_HASHTAG}` };

  it('returns null for a valid thread', () => {
    expect(
      validateThreadDraft({ tweets: [goodTweet], canonicalHashtag: DEFAULT_HASHTAG }),
    ).toBeNull();
  });

  it('rejects empty thread', () => {
    expect(validateThreadDraft({ tweets: [], canonicalHashtag: DEFAULT_HASHTAG })).toMatch(
      /at least one tweet/,
    );
  });

  it('rejects empty tweet text', () => {
    expect(
      validateThreadDraft({
        tweets: [{ text: '' }, goodTweet],
        canonicalHashtag: DEFAULT_HASHTAG,
      }),
    ).toMatch(/empty text/);
  });

  it('accepts a long-form tweet well past the old 280-char limit', () => {
    // X dropped the 280 ceiling; the engine no longer gates on it.
    const longForm = {
      text: `${'word '.repeat(180)}${DEFAULT_HASHTAG}`, // ~900 chars
      link: 'https://example.com/long-article-url',
    };
    expect(
      validateThreadDraft({ tweets: [longForm], canonicalHashtag: DEFAULT_HASHTAG }),
    ).toBeNull();
  });

  it('rejects a tweet past the 25,000-char long-form ceiling (fail-closed guard)', () => {
    const runaway = {
      text: `${'a'.repeat(25_001)} ${DEFAULT_HASHTAG}`,
    };
    const v = validateThreadDraft({ tweets: [runaway], canonicalHashtag: DEFAULT_HASHTAG });
    expect(v).toMatch(/exceeds X long-form ceiling/);
  });

  it('rejects when T1 is missing the canonical hashtag', () => {
    const v = validateThreadDraft({
      tweets: [{ text: 'no hashtag on this tweet' }],
      canonicalHashtag: DEFAULT_HASHTAG,
    });
    expect(v).toMatch(/missing canonical hashtag/);
  });
});

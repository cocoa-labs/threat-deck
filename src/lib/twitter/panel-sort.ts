/**
 * Phase 9.7 — X-feed panel editorial priority-band sort.
 *
 * The dashboard's X FEED panel pulls from ~30 curated accounts spanning
 * markets, crypto, policy, OSINT, and (since Phase 9.3) infosec + AI-cyber.
 * The naive `.slice(0, 20)` ordering let high-frequency markets/crypto
 * accounts (Lookonchain alone tweets every 30 min) bury the lower-volume
 * AI-cyber signal we built the platform to surface.
 *
 * This module is the editorial fix: a deterministic priority-band sort
 * that elevates infosec + AI-cyber-relevant tweets to top billing and
 * demotes generic crypto/markets noise to a small "context awareness"
 * tail. The bands are NOT a per-domain quota — they're an editorial
 * statement that the Threat Deck is an AI-cyber publication first.
 *
 * Bands (in slot priority order):
 *
 *   PRIMARY   (≤14 slots) — `domain === 'infosec'` OR
 *                           scoreByKeywords(text).band IN
 *                             ('confident_yes', 'gray')
 *                           (e.g. a Lookonchain tweet about an
 *                            AI-powered phishing campaign lifts here)
 *   SECONDARY (≤4  slots) — `domain === 'ai'` AND not already PRIMARY
 *                           (general AI news, context-relevant)
 *   TERTIARY  (≤2  slots) — `domain IN ('markets','crypto','policy','osint')`
 *                           AND scoreByKeywords band IN
 *                             ('low', 'confident_no')
 *                           (non-cyber surfaced only as awareness tail)
 *
 * Within each band, sorted by `createdAt DESC` so recency still wins
 * among editorially-equivalent tweets.
 *
 * Total cap: 20 tweets, matching the original `.slice(0, 20)`.
 *
 * Pure module — no React, no DOM, no I/O. Safe to import in tests +
 * the 'use client' panel component alike.
 */

import { scoreByKeywords } from '@/lib/ai-relevance/keywords';
import type { Tweet, TweetDomain } from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Slot budget per band. Total = MAX_PRIMARY + MAX_SECONDARY + MAX_TERTIARY. */
const MAX_PRIMARY = 14;
const MAX_SECONDARY = 4;
const MAX_TERTIARY = 2;

/** Domains that get top billing simply by being from an AI-cyber source. */
const PRIMARY_DOMAINS: ReadonlySet<TweetDomain> = new Set(['infosec']);

/** Domain that earns SECONDARY billing for being topically adjacent. */
const SECONDARY_DOMAIN: TweetDomain = 'ai';

/** Domains eligible for the awareness tail when their text is non-cyber. */
const TERTIARY_DOMAINS: ReadonlySet<TweetDomain> = new Set([
  'markets',
  'crypto',
  'policy',
  'osint',
]);

// ─── Public surface ──────────────────────────────────────────────────────────

/**
 * Is this tweet AI-cyber relevant by *content*, irrespective of source domain?
 *
 * Re-uses the Phase 9.2 keyword scorer so the X-feed panel and the Cyber
 * Wire publication share a single definition of "AI-cyber relevant" — one
 * source of editorial truth. The scorer is a pure regex sweep so this
 * function is sub-millisecond.
 *
 * Returns true when the score's `band` is `'confident_yes'` (strong AI-cyber
 * hit) or `'gray'` (single subcategory hit — likely relevant, Haiku would
 * tiebreak in the news pipeline but here we treat as relevant for editorial
 * billing).
 */
export function isAiCyberRelevant(tweet: Pick<Tweet, 'text'>): boolean {
  const result = scoreByKeywords({ title: tweet.text });
  return result.band === 'confident_yes' || result.band === 'gray';
}

/**
 * Partition the tweet list into editorial priority bands and return the
 * top ≤20 tweets, PRIMARY-first.
 *
 * Sort within each band is `createdAt DESC` so the most recent qualifying
 * tweets win the slots.
 *
 * A tweet is assigned to exactly one band — PRIMARY wins over SECONDARY
 * wins over TERTIARY. Tweets that don't match any band (e.g. an unknown
 * domain) are dropped from the panel entirely.
 */
export function partitionAndSort(tweets: readonly Tweet[]): Tweet[] {
  const primary: Tweet[] = [];
  const secondary: Tweet[] = [];
  const tertiary: Tweet[] = [];

  for (const tweet of tweets) {
    const aiCyberHit = isAiCyberRelevant(tweet);
    const domain = tweet.domain;

    // PRIMARY: infosec source OR AI-cyber-relevant text from any source.
    if ((domain && PRIMARY_DOMAINS.has(domain)) || aiCyberHit) {
      primary.push(tweet);
      continue;
    }

    // SECONDARY: general AI news (the purple `AI` domain) that didn't
    // already land in PRIMARY via its text content.
    if (domain === SECONDARY_DOMAIN) {
      secondary.push(tweet);
      continue;
    }

    // TERTIARY: markets/crypto/policy/osint with a non-cyber text — the
    // awareness tail. (If their text WAS cyber-relevant, they would have
    // hit PRIMARY via the aiCyberHit branch above.)
    if (domain && TERTIARY_DOMAINS.has(domain)) {
      tertiary.push(tweet);
    }

    // Unknown / unhandled domain → drop. Keeps the panel deterministic
    // even as new TweetDomain values are added — we choose to surface
    // them only after the bands are updated.
  }

  // Recency wins inside a band.
  const byNewest = (a: Tweet, b: Tweet) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  primary.sort(byNewest);
  secondary.sort(byNewest);
  tertiary.sort(byNewest);

  return [
    ...primary.slice(0, MAX_PRIMARY),
    ...secondary.slice(0, MAX_SECONDARY),
    ...tertiary.slice(0, MAX_TERTIARY),
  ];
}

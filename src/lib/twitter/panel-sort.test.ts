/**
 * Tests for the Phase 9.7 X-feed editorial priority-band sort.
 *
 * The sort is the editorial fix for the X FEED panel: it elevates
 * infosec + AI-cyber-relevant tweets to top billing and demotes generic
 * markets/crypto noise to a small awareness tail. These tests pin down
 * the band-assignment rules + the slot budgets so a future change to
 * the budgets or the scorer can't silently regress what the panel
 * surfaces.
 */

import { describe, expect, it } from 'vitest';
import type { Tweet, TweetDomain } from '@/lib/types';
import { isAiCyberRelevant, partitionAndSort } from './panel-sort';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;
function mkTweet(domain: TweetDomain, text: string, createdAt?: string): Tweet {
  idCounter += 1;
  return {
    id: `t-${idCounter}`,
    text,
    authorId: 'a-1',
    authorName: 'Author',
    authorUsername: 'author',
    createdAt: createdAt ?? new Date(Date.now() - idCounter * 60_000).toISOString(),
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    url: 'https://x.com/author/status/1',
    domain,
  };
}

// ─── isAiCyberRelevant ───────────────────────────────────────────────────────

describe('isAiCyberRelevant', () => {
  it('flags a tweet containing a strong AI-cyber term as relevant', () => {
    const tweet = mkTweet('crypto', 'WormGPT v3 leaked on darknet forums today');
    expect(isAiCyberRelevant(tweet)).toBe(true);
  });

  it('flags a tweet mentioning prompt injection as relevant', () => {
    const tweet = mkTweet('ai', 'New paper on prompt injection in agentic systems');
    expect(isAiCyberRelevant(tweet)).toBe(true);
  });

  it('does NOT flag a generic crypto whale tweet', () => {
    const tweet = mkTweet('crypto', 'Whale moved 1,200 ETH to Binance — HYPE breakout?');
    expect(isAiCyberRelevant(tweet)).toBe(false);
  });

  it('does NOT flag a markets earnings tweet', () => {
    const tweet = mkTweet('markets', 'NVDA earnings beat; AI capex still ripping');
    expect(isAiCyberRelevant(tweet)).toBe(false);
  });
});

// ─── partitionAndSort ────────────────────────────────────────────────────────

describe('partitionAndSort', () => {
  it('caps output at 20 tweets total', () => {
    const tweets: Tweet[] = [];
    for (let i = 0; i < 30; i++) tweets.push(mkTweet('infosec', `ransomware update ${i}`));
    const out = partitionAndSort(tweets);
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it('places infosec-domain tweets in PRIMARY ahead of generic markets tweets', () => {
    const infosec = mkTweet('infosec', 'CISA hiring announcement (administrative)');
    const market = mkTweet('markets', 'SPY closed at 6500 — record high');
    const out = partitionAndSort([market, infosec]);
    expect(out[0]?.id).toBe(infosec.id);
  });

  it('lifts a crypto-source tweet to PRIMARY when its text is AI-cyber relevant', () => {
    // Explicit timestamps so the recency-within-band assertion is unambiguous.
    const ransomwareCrypto = mkTweet(
      'crypto',
      'WormGPT-powered phishing campaign drains $4M in ETH',
      new Date('2025-05-02T00:00:00Z').toISOString(),
    );
    const adminInfosec = mkTweet(
      'infosec',
      'CISA director keynote at RSA next month',
      new Date('2025-05-01T00:00:00Z').toISOString(),
    );
    const out = partitionAndSort([adminInfosec, ransomwareCrypto]);
    // Both qualify for PRIMARY (one by domain, one by AI-cyber-relevant text).
    // Within-band sort is createdAt DESC, so the newer crypto tweet wins slot 0.
    expect(out[0]?.id).toBe(ransomwareCrypto.id);
    expect(out[1]?.id).toBe(adminInfosec.id);
  });

  it('keeps an infosec tweet in PRIMARY even when its text has no AI-cyber hit', () => {
    // confident_no path — administrative news from an infosec source.
    // The source-domain rule MUST still lift it to PRIMARY.
    const adminInfosec = mkTweet('infosec', 'CISA hosting a hiring fair in Arlington next quarter');
    const out = partitionAndSort([adminInfosec]);
    expect(out).toContainEqual(adminInfosec);
    expect(out[0]?.id).toBe(adminInfosec.id);
  });

  it('places ai-domain tweets in SECONDARY (after PRIMARY, before TERTIARY)', () => {
    const infosec = mkTweet('infosec', 'KEV add: CVE-2025-12345 actively exploited');
    const aiNews = mkTweet('ai', 'OpenAI launches new model with 1M context window');
    const market = mkTweet('markets', 'Yields rip on hot CPI print');
    const out = partitionAndSort([market, aiNews, infosec]);
    expect(out[0]?.id).toBe(infosec.id);
    expect(out[1]?.id).toBe(aiNews.id);
    expect(out[2]?.id).toBe(market.id);
  });

  it('relegates non-cyber crypto/markets/policy/osint tweets to TERTIARY (≤2)', () => {
    const infosecs: Tweet[] = [];
    for (let i = 0; i < 14; i++) infosecs.push(mkTweet('infosec', `cve update ${i}`));
    const markets: Tweet[] = [];
    for (let i = 0; i < 5; i++) markets.push(mkTweet('markets', `SPX print ${i}`));
    const cryptos: Tweet[] = [];
    for (let i = 0; i < 5; i++) cryptos.push(mkTweet('crypto', `whale move ${i}`));

    const out = partitionAndSort([...markets, ...cryptos, ...infosecs]);

    // First 14 should be infosec (PRIMARY budget = 14).
    for (let i = 0; i < 14; i++) {
      expect(out[i]?.domain).toBe('infosec');
    }
    // Tail is at most 2 (TERTIARY budget).
    const tail = out.slice(14);
    expect(tail.length).toBeLessThanOrEqual(2);
    for (const t of tail) {
      expect(['markets', 'crypto', 'policy', 'osint']).toContain(t.domain);
    }
  });

  it('drops tweets with undefined / unknown domain rather than surfacing them', () => {
    const known = mkTweet('infosec', 'ransomware alert');
    const undef: Tweet = { ...mkTweet('infosec', 'x'), domain: undefined };
    const out = partitionAndSort([known, undef]);
    expect(out.map((t) => t.id)).toEqual([known.id]);
  });

  it('sorts within a band by createdAt DESC (recency wins)', () => {
    const older = mkTweet(
      'infosec',
      'older cve update',
      new Date('2025-01-01T00:00:00Z').toISOString(),
    );
    const newer = mkTweet(
      'infosec',
      'newer cve update',
      new Date('2025-06-01T00:00:00Z').toISOString(),
    );
    const out = partitionAndSort([older, newer]);
    expect(out[0]?.id).toBe(newer.id);
    expect(out[1]?.id).toBe(older.id);
  });
});

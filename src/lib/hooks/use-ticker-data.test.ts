import { describe, expect, it } from 'vitest';
import {
  buildBottomMarketTickerItems,
  buildBottomNewsTickerItems,
  buildTopThreatTickerItems,
  buildTopVulnerabilityTickerItems,
} from '@/lib/hooks/use-ticker-data';
import type {
  BreachDisclosure,
  CryptoPrice,
  CVE,
  FedData,
  KEV,
  MarketQuote,
  NewsItem,
} from '@/lib/types';

const now = '2026-05-27T06:00:00.000Z';

function news(partial: Partial<NewsItem> & Pick<NewsItem, 'id' | 'title' | 'category'>): NewsItem {
  return {
    url: `https://example.com/${partial.id}`,
    source: 'Example Wire',
    publishedAt: now,
    ...partial,
  };
}

function quote(partial: Partial<MarketQuote> & Pick<MarketQuote, 'symbol'>): MarketQuote {
  return {
    name: partial.symbol,
    price: 100,
    change: 1,
    changePct: 1,
    timestamp: now,
    ...partial,
  };
}

describe('ticker data builders', () => {
  it('carries AI/cyber/social news and drops other categories', () => {
    const items = buildTopThreatTickerItems([
      news({ id: 'cyber-1', title: 'Ransomware crew targets edge devices', category: 'cyber' }),
      news({ id: 'world-1', title: 'General world headline', category: 'politics' }),
    ]);

    expect(items.some((item) => item.id === 'cyber-cyber-1')).toBe(true);
    expect(items.some((item) => item.id === 'cyber-world-1')).toBe(false);
  });

  // The regression that put four Chrome release notes at the head of the
  // marquee: the row used to prepend up to 5 unacknowledged alerts with no
  // severity floor and no expiry. Note this cannot be guarded by an
  // emptiness-dependent test — the branch sat dormant for months purely because
  // `alerts-store` had no writer, and looked fine the whole time.
  it('never emits an alert item, whatever the alert board looks like', () => {
    const items = buildTopThreatTickerItems([
      news({ id: 'cyber-1', title: 'Ransomware crew targets edge devices', category: 'cyber' }),
      news({ id: 'ai-1', title: 'New model safety benchmark', category: 'ai' }),
    ]);

    expect(items.every((item) => item.kind !== ('alert' as unknown))).toBe(true);
    expect(items.every((item) => item.source !== 'ALERT')).toBe(true);
    expect(items.every((item) => !item.id.startsWith('alert-'))).toBe(true);
    // Length tracks the news list alone — nothing is stacked on top.
    expect(items).toHaveLength(2);
  });

  it('labels AI and X pulse items clearly in the top threat row', () => {
    const items = buildTopThreatTickerItems([
      news({
        id: 'ai-1',
        title: 'OpenAI announces new model safety benchmark',
        category: 'ai',
        source: 'OpenAI News',
      }),
      news({
        id: 'x-1',
        title: 'Claude model release benchmark shows a new agentic safety frontier.',
        category: 'social',
        source: '@AnthropicAI',
      }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['ai', 'social']);
    expect(items.map((item) => item.source)).toEqual(['OPENAI', '@AnthropicAI']);
    expect(items[0]?.analyzePrompt).toBe(
      'Analyze this: OpenAI announces new model safety benchmark',
    );
  });

  it('compacts long top-row social text while preserving full context', () => {
    const longTweet =
      'Claude Mythos is $25 per million input tokens and $125 per million output tokens. I assume that the Mythos-like model that Anthropic will release in the coming weeks will be just as expensive. lets see';
    const shortHeadline = 'OpenAI announces new model safety benchmark';

    const items = buildTopThreatTickerItems([
      news({
        id: 'x-long',
        title: longTweet,
        category: 'social',
        source: '@kimmonismus',
      }),
      news({
        id: 'ai-short',
        title: shortHeadline,
        category: 'ai',
        source: 'OpenAI News',
      }),
    ]);

    expect(items[0]?.text.length).toBeLessThanOrEqual(96);
    expect(items[0]?.text.endsWith('...')).toBe(true);
    expect(items[0]?.fullText).toBe(longTweet);
    expect(items[0]?.analyzePrompt).toBe(`Analyze this: ${longTweet}`);
    expect(items[1]?.text).toBe(shortHeadline);
    expect(items[1]?.fullText).toBeUndefined();
  });

  it('builds the top vulnerability row from critical CVEs, KEV entries, and breaches', () => {
    const cves: CVE[] = [
      {
        cveId: 'CVE-2026-0001',
        publishedAt: now,
        summary: 'Critical edge appliance bug',
        cvssV3Score: 9.8,
        severity: 'critical',
        isKev: true,
        exploitedInWild: true,
        pocPublic: true,
        nvdSourceUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-0001',
      },
    ];
    const kev: KEV[] = [
      {
        cveId: 'CVE-2026-0002',
        addedToKevAt: now,
        vendorProject: 'Example Vendor',
        requiredAction: 'Apply vendor update',
      },
    ];
    const breaches: BreachDisclosure[] = [
      {
        id: 7,
        disclosedAt: now,
        breachType: 'ransomware',
        source: 'hibp',
        sourceUrl: 'https://example.com/breach',
        recordsCompromised: 2_400_000,
        notes: 'Breach disclosure',
      },
    ];

    const items = buildTopVulnerabilityTickerItems(cves, kev, breaches);

    expect(items.map((item) => item.kind)).toEqual(['cve', 'kev', 'breach']);
    expect(items[0]?.symbol).toBe('CVE-2026-0001');
    expect(items[0]?.detail).toBe('KEV');
    expect(items[1]?.detail).toBe('EXPLOITED');
    expect(items[2]?.value).toBe('2.4M recs');
  });

  it('keeps cyber-only duplicates out of the bottom news row where practical', () => {
    const items = buildBottomNewsTickerItems([
      news({ id: 'cyber-1', title: 'Cyber headline already has a top lane', category: 'cyber' }),
      news({ id: 'finance-1', title: 'Markets rally into the close', category: 'finance' }),
      news({ id: 'politics-1', title: 'Top global policy story', category: 'politics' }),
    ]);

    expect(items.map((item) => item.id)).toEqual([
      'bottom-news-finance-1',
      'bottom-news-politics-1',
    ]);
  });

  it('builds the bottom markets row from quotes, crypto, rates, and macro data', () => {
    const crypto: CryptoPrice[] = [
      {
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        price: 105_000,
        change24h: -2.4,
        marketCap: 2_000_000_000_000,
        volume24h: 50_000_000_000,
        url: 'https://www.coingecko.com/en/coins/bitcoin',
      },
    ];
    const fedData: FedData = {
      fedFunds: { value: 4.33, date: now },
      treasury10Y: { value: 4.52, date: now },
      yieldSpread: { value: -0.12, date: now },
      cpi: { value: 2.9, change: -0.2, date: now },
    };

    const items = buildBottomMarketTickerItems({
      indices: [quote({ symbol: 'SPY', price: 632.45, changePct: 0.7 })],
      commodities: [
        quote({ symbol: 'GLD', price: 298.1, changePct: -0.4 }),
        quote({ symbol: 'ZERO', price: 0, changePct: 0 }),
      ],
      crypto,
      fedData,
    });

    expect(items.some((item) => item.id === 'market-ZERO')).toBe(false);
    expect(items.map((item) => item.kind)).toEqual([
      'market',
      'market',
      'crypto',
      'rates',
      'rates',
      'rates',
      'macro',
    ]);
    expect(items.find((item) => item.id === 'crypto-bitcoin')?.tone).toBe('negative');
    expect(items.find((item) => item.id === 'rates-10y2y')?.detail).toBe('INVERTED');
  });
});

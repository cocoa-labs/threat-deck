'use client';

import { useEffect, useMemo } from 'react';
import { DEFAULT_CHANNELS } from '@/lib/data/livestream-channels';
import type { CompanionTickerItem } from '@/lib/store/companion-store';
import { useCompanionStore } from '@/lib/store/companion-store';
import { useDataStore } from '@/lib/store/data-store';

const TICKER_REFRESH_MS = 30_000;

/**
 * Map channel categories to relevant news categories from data-store.
 */
function getNewsCategories(channelCategory: 'finance' | 'crypto' | 'geopolitical'): string[] {
  switch (channelCategory) {
    case 'finance':
      return ['finance', 'tech'];
    case 'crypto':
      return ['tech', 'finance'];
    case 'geopolitical':
      return ['politics', 'gov'];
  }
}

/**
 * Derives ticker items from existing data-store state based on the active channel's category.
 * No API calls — purely reads from already-fetched data (indices, news, crypto, prediction markets).
 * Updates companion-store tickerItems every 30s.
 */
export function useCompanionTicker(channelId: string | null) {
  const indices = useDataStore((s) => s.indices);
  const news = useDataStore((s) => s.news);
  const crypto = useDataStore((s) => s.crypto);
  const predictionMarkets = useDataStore((s) => s.predictionMarkets);
  const contextUpdates = useCompanionStore((s) => s.contextUpdates);
  const setTickerItems = useCompanionStore((s) => s.setTickerItems);

  const channel = useMemo(
    () => (channelId ? DEFAULT_CHANNELS.find((c) => c.id === channelId) : undefined),
    [channelId],
  );

  const tickerItems = useMemo((): CompanionTickerItem[] => {
    if (!channel) return [];

    const items: CompanionTickerItem[] = [];
    const category = channel.category;

    // Market indices — always relevant for finance, useful context for others
    if (category === 'finance' || category === 'crypto') {
      for (const quote of indices.slice(0, 5)) {
        const sign = quote.changePct >= 0 ? '+' : '';
        items.push({
          id: `mkt-${quote.symbol}`,
          text: `${quote.symbol} ${quote.price.toLocaleString()} (${sign}${quote.changePct.toFixed(2)}%)`,
          source: 'Markets',
          type: 'market',
        });
      }
    }

    // Crypto prices for crypto channels
    if (category === 'crypto') {
      for (const coin of crypto.slice(0, 5)) {
        const sign = coin.change24h >= 0 ? '+' : '';
        items.push({
          id: `crypto-${coin.id}`,
          text: `${coin.symbol.toUpperCase()} $${coin.price.toLocaleString()} (${sign}${coin.change24h.toFixed(1)}%)`,
          source: 'Crypto',
          type: 'market',
        });
      }
    }

    // News headlines based on channel category
    const newsCategories = getNewsCategories(category);
    for (const cat of newsCategories) {
      const categoryNews = news[cat];
      if (!categoryNews) continue;
      for (const item of categoryNews.slice(0, 3)) {
        items.push({
          id: `news-${item.id}`,
          text: item.title,
          source: item.source,
          type: 'headline',
          url: item.url,
        });
      }
    }

    // Prediction markets for geopolitical channels
    if (category === 'geopolitical') {
      for (const market of predictionMarkets.slice(0, 3)) {
        items.push({
          id: `pred-${market.id}`,
          text: `${market.question} — ${(market.probability * 100).toFixed(0)}%`,
          source: 'Polymarket',
          type: 'insight',
          url: market.url,
        });
      }
    }

    // Context updates from companion (CC digests, cross-references)
    for (const update of contextUpdates.slice(0, 3)) {
      items.push({
        id: `ctx-${update.id}`,
        text: update.title,
        source: update.source ?? 'Companion',
        type: 'insight',
        url: update.url,
      });
    }

    return items;
  }, [channel, indices, news, crypto, predictionMarkets, contextUpdates]);

  // Write derived ticker items to companion-store on interval
  useEffect(() => {
    if (!channelId) return;

    setTickerItems(tickerItems);

    const interval = setInterval(() => {
      setTickerItems(tickerItems);
    }, TICKER_REFRESH_MS);

    return () => clearInterval(interval);
  }, [channelId, tickerItems, setTickerItems]);
}

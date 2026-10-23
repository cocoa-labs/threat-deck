import { safeFetch } from '@/lib/security/safe-fetch';
import type { PredictionMarket } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const GAMMA_BASE = 'https://gamma-api.polymarket.com/events';

// ─── Fallback Demo Data ───

const DEMO_MARKETS: PredictionMarket[] = [
  {
    id: 'demo-poly-1',
    question: 'Will the Fed cut rates by March 2026?',
    category: 'Economics',
    probability: 0.35,
    volume: 12_500_000,
    endDate: '2026-03-31',
    url: 'https://polymarket.com/markets?_q=Will%20the%20Fed%20cut%20rates%20by%20March%202026%3F',
  },
  {
    id: 'demo-poly-2',
    question: 'Will Bitcoin reach $150K in 2026?',
    category: 'Crypto',
    probability: 0.22,
    volume: 8_750_000,
    endDate: '2026-12-31',
    url: 'https://polymarket.com/markets?_q=Will%20Bitcoin%20reach%20%24150K%20in%202026%3F',
  },
  {
    id: 'demo-poly-3',
    question: 'US GDP growth above 3% in Q1 2026?',
    category: 'Economics',
    probability: 0.41,
    volume: 3_200_000,
    endDate: '2026-04-30',
    url: 'https://polymarket.com/markets?_q=US%20GDP%20growth%20above%203%25%20in%20Q1%202026%3F',
  },
  {
    id: 'demo-poly-4',
    question: 'Will there be a ceasefire in Ukraine by June 2026?',
    category: 'Geopolitics',
    probability: 0.18,
    volume: 15_400_000,
    endDate: '2026-06-30',
    url: 'https://polymarket.com/markets?_q=Will%20there%20be%20a%20ceasefire%20in%20Ukraine%20by%20June%202026%3F',
  },
  {
    id: 'demo-poly-5',
    question: 'Will AI regulation bill pass US Congress in 2026?',
    category: 'Politics',
    probability: 0.28,
    volume: 5_100_000,
    endDate: '2026-12-31',
    url: 'https://polymarket.com/markets?_q=Will%20AI%20regulation%20bill%20pass%20US%20Congress%20in%202026%3F',
  },
  {
    id: 'demo-poly-6',
    question: 'S&P 500 closes above 6000 by end of Q1 2026?',
    category: 'Markets',
    probability: 0.62,
    volume: 9_800_000,
    endDate: '2026-03-31',
    url: 'https://polymarket.com/markets?_q=S%26P%20500%20closes%20above%206000%20by%20end%20of%20Q1%202026%3F',
  },
];

// ─── Public API ───

export interface PredictionMarketParams {
  category?: string;
  limit?: number;
}

/**
 * Fetch prediction markets from Polymarket Gamma API.
 * No API key required. Falls back to demo data on failure.
 */
export async function fetchPredictionMarkets(
  params?: PredictionMarketParams,
): Promise<PredictionMarket[]> {
  const cacheKey = 'polymarket:markets';
  const cached = await getCached<PredictionMarket[]>(cacheKey);
  if (cached) return filterMarkets(cached, params);

  if (!checkRateLimit('polymarket')) {
    return filterMarkets(DEMO_MARKETS, params);
  }

  try {
    const limit = params?.limit ?? 20;
    const url = `${GAMMA_BASE}?active=true&closed=false&limit=${limit}&order=volume24hr&ascending=false`;

    const res = await safeFetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn(`[Polymarket] Gamma API returned ${res.status}`);
      return filterMarkets(DEMO_MARKETS, params);
    }

    const events: GammaEvent[] = await res.json();

    if (!Array.isArray(events) || events.length === 0) {
      return filterMarkets(DEMO_MARKETS, params);
    }

    const markets: PredictionMarket[] = [];

    for (const event of events) {
      const market = pickActiveMarket(event);
      if (!market) continue;

      const eventId = event.id ?? `poly-${Date.now()}-${markets.length}`;
      const question = market.question ?? event.title ?? 'Unknown market';
      const category = event.tags?.[0]?.label ?? 'General';
      const probability = parseOutcomePrices(market.outcomePrices);
      const volume = market.volumeNum ?? parseFloat(market.volume ?? '0') ?? 0;
      const endDate = market.endDateIso ?? market.endDate ?? event.endDate ?? undefined;
      const url = event.slug
        ? `https://polymarket.com/event/${event.slug}`
        : `https://polymarket.com/markets?_q=${encodeURIComponent(question)}`;

      markets.push({ id: eventId, question, category, probability, volume, endDate, url });
    }

    if (markets.length === 0) {
      return filterMarkets(DEMO_MARKETS, params);
    }

    markets.sort((a, b) => b.volume - a.volume);

    await setCache(cacheKey, markets);
    return filterMarkets(markets, params);
  } catch (error) {
    console.warn(
      '[Polymarket] Failed to fetch markets:',
      error instanceof Error ? error.message : error,
    );
    return filterMarkets(DEMO_MARKETS, params);
  }
}

// ─── Internal Helpers ───

/** Pick the first active, non-closed market from an event, or fall back to the first market. */
function pickActiveMarket(event: GammaEvent): GammaMarket | undefined {
  if (!event.markets || event.markets.length === 0) return undefined;
  return event.markets.find((m) => m.active !== false && m.closed !== true) ?? event.markets[0];
}

/** Parse Gamma outcomePrices JSON string → "Yes" probability (index 0). */
function parseOutcomePrices(outcomePrices?: string): number {
  if (typeof outcomePrices !== 'string') return 0.5;
  try {
    const prices: string[] = JSON.parse(outcomePrices);
    const first = prices[0];
    if (first === undefined) return 0.5;
    const val = parseFloat(first);
    return Number.isNaN(val) ? 0.5 : val;
  } catch {
    return 0.5;
  }
}

function filterMarkets(
  markets: PredictionMarket[],
  params?: PredictionMarketParams,
): PredictionMarket[] {
  if (!params) return markets;

  let filtered = markets;

  if (params.category) {
    const categoryLower = params.category.toLowerCase();
    filtered = filtered.filter((m) => m.category.toLowerCase().includes(categoryLower));
  }

  if (params.limit) {
    filtered = filtered.slice(0, params.limit);
  }

  return filtered;
}

// ─── Gamma API Response Types ───

interface GammaTag {
  label: string;
  slug?: string;
}

interface GammaMarket {
  id?: string;
  question?: string;
  outcomes?: string;
  outcomePrices?: string;
  volumeNum?: number;
  volume?: string;
  endDateIso?: string;
  endDate?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
}

interface GammaEvent {
  id?: string;
  title?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  tags?: GammaTag[];
  markets?: GammaMarket[];
  endDate?: string;
}

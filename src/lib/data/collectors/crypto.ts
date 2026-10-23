import { safeFetch } from '@/lib/security/safe-fetch';
import type { CryptoPrice } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

// Pro plan ($35/mo+): pro-api.coingecko.com with x-cg-pro-api-key header
// Demo/free: api.coingecko.com with x-cg-demo-api-key header
// Set COINGECKO_PRO=true in .env.local to use the pro endpoint
const API_KEY = () => process.env.COINGECKO_API_KEY;
const IS_PRO = () => process.env.COINGECKO_PRO === 'true';

function getBaseUrl(): string {
  return IS_PRO() ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
}

// ─── Fallback Demo Data ───

const DEMO_CRYPTO: CryptoPrice[] = [
  {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    price: 97_250.0,
    change24h: 2.15,
    marketCap: 1_910_000_000_000,
    volume24h: 42_500_000_000,
    sparkline: [96_100, 96_400, 96_800, 97_100, 96_900, 97_250],
    url: 'https://www.coingecko.com/en/coins/bitcoin',
  },
  {
    id: 'ethereum',
    symbol: 'eth',
    name: 'Ethereum',
    price: 3_420.0,
    change24h: 1.85,
    marketCap: 411_000_000_000,
    volume24h: 18_200_000_000,
    sparkline: [3_350, 3_370, 3_390, 3_400, 3_410, 3_420],
    url: 'https://www.coingecko.com/en/coins/ethereum',
  },
  {
    id: 'solana',
    symbol: 'sol',
    name: 'Solana',
    price: 198.5,
    change24h: -0.72,
    marketCap: 95_000_000_000,
    volume24h: 4_100_000_000,
    sparkline: [200.1, 199.8, 199.2, 198.9, 198.7, 198.5],
    url: 'https://www.coingecko.com/en/coins/solana',
  },
  {
    id: 'binancecoin',
    symbol: 'bnb',
    name: 'BNB',
    price: 685.0,
    change24h: 0.45,
    marketCap: 99_000_000_000,
    volume24h: 1_800_000_000,
    sparkline: [682, 683, 684, 683.5, 684.5, 685],
    url: 'https://www.coingecko.com/en/coins/binancecoin',
  },
  {
    id: 'ripple',
    symbol: 'xrp',
    name: 'XRP',
    price: 2.48,
    change24h: 3.21,
    marketCap: 142_000_000_000,
    volume24h: 8_500_000_000,
    sparkline: [2.38, 2.4, 2.42, 2.44, 2.46, 2.48],
    url: 'https://www.coingecko.com/en/coins/ripple',
  },
];

// ─── Public API ───

/**
 * Fetch top cryptocurrency prices from CoinGecko.
 * Uses pro API key header when available, falls back to demo data.
 */
export async function fetchCryptoPrices(limit: number = 20): Promise<CryptoPrice[]> {
  const cacheKey = 'crypto:prices';
  const cached = await getCached<CryptoPrice[]>(cacheKey);
  if (cached) return cached.slice(0, limit);

  if (!checkRateLimit('coingecko')) {
    return DEMO_CRYPTO.slice(0, limit);
  }

  try {
    const apiKey = API_KEY();
    const isPro = IS_PRO();
    const baseUrl = getBaseUrl();

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (apiKey) {
      headers[isPro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = apiKey;
    }

    const url = `${baseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&sparkline=true`;

    const res = await safeFetch(url, { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[Crypto] CoinGecko API returned ${res.status}: ${body.slice(0, 200)}`);
      return DEMO_CRYPTO.slice(0, limit);
    }

    const data: CoinGeckoMarketItem[] = await res.json();

    const prices: CryptoPrice[] = data.map((coin) => ({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      price: coin.current_price ?? 0,
      change24h: coin.price_change_percentage_24h ?? 0,
      marketCap: coin.market_cap ?? 0,
      volume24h: coin.total_volume ?? 0,
      sparkline: coin.sparkline_in_7d?.price?.slice(-24) ?? undefined,
      url: `https://www.coingecko.com/en/coins/${coin.id}`,
    }));

    await setCache(cacheKey, prices);
    return prices;
  } catch (error) {
    console.warn(
      '[Crypto] Failed to fetch prices:',
      error instanceof Error ? error.message : error,
    );
    return DEMO_CRYPTO.slice(0, limit);
  }
}

// ─── CoinGecko Response Types ───

interface CoinGeckoMarketItem {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
  sparkline_in_7d?: {
    price: number[];
  };
}

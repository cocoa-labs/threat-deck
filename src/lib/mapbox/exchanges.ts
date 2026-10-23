/**
 * Crypto exchange → HQ location lookup.
 * Maps top ~25 cryptocurrency exchanges to real HQ locations.
 */

export const EXCHANGE_COORDS: Record<string, { lat: number; lon: number; name: string }> = {
  binance: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  coinbase: { lat: 37.77, lon: -122.42, name: 'San Francisco' },
  kraken: { lat: 37.77, lon: -122.42, name: 'San Francisco' },
  bitfinex: { lat: 22.32, lon: 114.17, name: 'Hong Kong' },
  okx: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  bybit: { lat: 25.2, lon: 55.27, name: 'Dubai' },
  gemini: { lat: 40.71, lon: -74.01, name: 'New York' },
  bitstamp: { lat: 46.06, lon: 14.51, name: 'Ljubljana' },
  'crypto.com': { lat: 1.35, lon: 103.82, name: 'Singapore' },
  'gate.io': { lat: 1.35, lon: 103.82, name: 'Singapore' },
  kucoin: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  huobi: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  htx: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  upbit: { lat: 37.56, lon: 126.98, name: 'Seoul' },
  bitget: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  mexc: { lat: 1.35, lon: 103.82, name: 'Singapore' },
  bithumb: { lat: 37.56, lon: 126.98, name: 'Seoul' },
  bitflyer: { lat: 35.68, lon: 139.69, name: 'Tokyo' },
  deribit: { lat: 52.01, lon: 4.36, name: 'Amsterdam' },
  ftx: { lat: 25.79, lon: -80.19, name: 'Miami' },
  robinhood: { lat: 37.5, lon: -122.2, name: 'Menlo Park' },
  etoro: { lat: 32.07, lon: 34.77, name: 'Tel Aviv' },
  'blockchain.com': { lat: 51.51, lon: -0.13, name: 'London' },
  celsius: { lat: 40.74, lon: -73.99, name: 'New York' },
  nexo: { lat: 51.51, lon: -0.13, name: 'London' },
};

/**
 * Look up exchange HQ coordinates by name.
 */
export function lookupExchangeCoords(name: string): { lat: number; lon: number } | null {
  const lower = name.toLowerCase().trim();
  // Exact match
  if (EXCHANGE_COORDS[lower]) {
    const entry = EXCHANGE_COORDS[lower]!;
    return { lat: entry.lat, lon: entry.lon };
  }
  // Check if the name contains a known exchange
  for (const [key, coords] of Object.entries(EXCHANGE_COORDS)) {
    if (lower.includes(key) || key.includes(lower)) {
      return { lat: coords.lat, lon: coords.lon };
    }
  }
  return null;
}

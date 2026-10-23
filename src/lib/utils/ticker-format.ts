import type { CryptoPrice, MarketQuote, Severity } from '@/lib/types';

/**
 * Format a market quote for the ticker display.
 * Example: "SPY 690.62 ▲+1.34%" or "DIA 421.30 ▼-0.52%"
 */
export function formatMarketTicker(quote: MarketQuote): string {
  const arrow = quote.changePct >= 0 ? '▲' : '▼';
  const sign = quote.changePct >= 0 ? '+' : '';
  return `${quote.symbol} ${quote.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${arrow}${sign}${quote.changePct.toFixed(2)}%`;
}

/**
 * Format a crypto price for the ticker display.
 * Example: "BTC $104,200 ▼-2.1%"
 */
export function formatCryptoTicker(crypto: CryptoPrice): string {
  const arrow = crypto.change24h >= 0 ? '▲' : '▼';
  const sign = crypto.change24h >= 0 ? '+' : '';
  const priceStr =
    crypto.price >= 1
      ? `$${crypto.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${crypto.price.toFixed(4)}`;
  return `${crypto.symbol.toUpperCase()} ${priceStr} ${arrow}${sign}${crypto.change24h.toFixed(1)}%`;
}

/**
 * Format an ISO date string as a relative time.
 * Examples: "2m ago", "1h ago", "3h ago", "1d ago"
 */
export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return 'now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Determine ticker severity based on percentage change magnitude.
 */
export function tickerSeverityFromChange(changePct: number): Severity {
  const abs = Math.abs(changePct);
  if (abs >= 3) return 'high';
  if (abs >= 1) return 'medium';
  return 'low';
}

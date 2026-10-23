const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const largeCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const relativeFormatter = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto',
});

export function formatCompact(value: number): string {
  return compactFormatter.format(value);
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatLargeCurrency(value: number): string {
  return largeCurrencyFormatter.format(value);
}

export function formatPercent(value: number): string {
  return percentFormatter.format(value / 100);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return dateFormatter.format(d);
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const diffSecs = Math.round(diffMs / 1000);
  const diffMins = Math.round(diffSecs / 60);
  const diffHours = Math.round(diffMins / 60);
  const diffDays = Math.round(diffHours / 24);

  if (Math.abs(diffSecs) < 60) return relativeFormatter.format(diffSecs, 'second');
  if (Math.abs(diffMins) < 60) return relativeFormatter.format(diffMins, 'minute');
  if (Math.abs(diffHours) < 24) return relativeFormatter.format(diffHours, 'hour');
  return relativeFormatter.format(diffDays, 'day');
}

export function formatPriceChange(change: number): {
  text: string;
  color: 'positive' | 'negative' | 'neutral';
} {
  const prefix = change >= 0 ? '+' : '';
  return {
    text: `${prefix}${change.toFixed(2)}%`,
    color: change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral',
  };
}

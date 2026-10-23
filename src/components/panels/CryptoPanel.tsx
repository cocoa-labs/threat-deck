'use client';

import { ExternalLink, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useCryptoData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { CryptoPrice } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatLargeCurrency, formatPriceChange } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const MAX_COINS = 10;

const COIN_COLORS: Record<string, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#00ffa3',
  BNB: '#f3ba2f',
  XRP: '#00aae4',
  ADA: '#0033ad',
  DOGE: '#c2a633',
  AVAX: '#e84142',
  DOT: '#e6007a',
  MATIC: '#8247e5',
  LINK: '#2a5ada',
  UNI: '#ff007a',
};

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="flex items-center justify-between py-1.5 px-1">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 animate-pulse rounded-full bg-[var(--bg-hover)]" />
        <div className="space-y-1">
          <div className="h-2.5 w-12 animate-pulse rounded bg-[var(--bg-hover)]" />
          <div className="h-2 w-8 animate-pulse rounded bg-[var(--bg-hover)]" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
    </div>
  );
}

/* ─── Coin Row ─── */

function CoinRow({ coin, rank }: { coin: CryptoPrice; rank: number }) {
  const { text, color } = formatPriceChange(coin.change24h);
  const dotColor = COIN_COLORS[coin.symbol.toUpperCase()] ?? 'var(--text-dim)';

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `Analyze ${coin.name} (${coin.symbol.toUpperCase()}) price action at $${formatCurrency(coin.price)} (${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(2)}% 24h). What's driving the move?`,
          {
            sourcePanel: 'crypto',
            dataType: 'crypto_price',
            trendData: {
              symbol: coin.symbol,
              price: coin.price,
              change24h: coin.change24h,
              marketCap: coin.marketCap,
              volume24h: coin.volume24h,
              sourceUrl: coin.url,
            },
          },
        )
      }
      className="flex items-center justify-between py-1 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] cursor-pointer text-left w-full"
    >
      {/* Left: rank, icon, name */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[8px] font-mono text-[var(--text-muted)] w-3 text-right tabular-nums shrink-0">
          {rank}
        </span>

        {/* Colored circle icon */}
        <div
          className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center"
          style={{ backgroundColor: `${dotColor}20`, border: `1px solid ${dotColor}40` }}
        >
          <span className="text-[7px] font-mono font-bold" style={{ color: dotColor }}>
            {coin.symbol.slice(0, 2)}
          </span>
        </div>

        <div className="min-w-0">
          <span className="text-[var(--text-xs)] font-mono font-semibold text-[var(--text-primary)] block truncate">
            {coin.name}
          </span>
          <span className="text-[8px] font-mono text-[var(--text-muted)] block">
            {coin.symbol.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Right: price, change, market cap, link */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Market cap */}
        <span className="crypto-mcap text-[8px] font-mono text-[var(--text-dim)] tabular-nums">
          {formatLargeCurrency(coin.marketCap)}
        </span>

        {/* Price */}
        <span className="text-[var(--text-xs)] font-mono text-[var(--text-primary)] tabular-nums min-w-[64px] text-right">
          {formatCurrency(coin.price)}
        </span>

        {/* Change */}
        <div className="flex items-center gap-0.5 min-w-[52px] justify-end">
          {color === 'positive' ? (
            <TrendingUp size={9} className="text-[var(--color-positive)]" />
          ) : color === 'negative' ? (
            <TrendingDown size={9} className="text-[var(--color-negative)]" />
          ) : (
            <Minus size={9} className="text-[var(--text-muted)]" />
          )}
          <span
            className={cn(
              'text-[9px] font-mono font-medium tabular-nums',
              color === 'positive' && 'text-[var(--color-positive)]',
              color === 'negative' && 'text-[var(--color-negative)]',
              color === 'neutral' && 'text-[var(--text-muted)]',
            )}
          >
            {text}
          </span>
        </div>

        {/* External link */}
        {coin.url && (
          <a
            href={coin.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors"
          >
            <ExternalLink size={10} />
          </a>
        )}
      </div>
    </button>
  );
}

/* ─── CryptoPanel ─── */

export function CryptoPanel() {
  const { isLoading } = useCryptoData();
  const crypto = useDataStore((s) => s.crypto);

  const visibleCoins = crypto.slice(0, MAX_COINS);
  const hasData = visibleCoins.length > 0;

  return (
    <PanelShell id="crypto" title="CRYPTO" span={1}>
      <style>{`.crypto-mcap { display: none; } @container (min-width: 400px) { .crypto-mcap { display: inline; } }`}</style>
      {isLoading && !hasData ? (
        <div className="space-y-0.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No crypto data available
          </span>
        </div>
      ) : (
        <div className="space-y-0">
          {/* Column headers */}
          <div className="flex items-center justify-between px-1 pb-1 border-b border-[var(--border-subtle)]">
            <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Asset
            </span>
            <div className="flex items-center gap-2">
              <span className="crypto-mcap text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                MCap
              </span>
              <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)] min-w-[64px] text-right">
                Price
              </span>
              <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)] min-w-[52px] text-right">
                24h
              </span>
            </div>
          </div>

          {/* Coin rows */}
          {visibleCoins.map((coin, i) => (
            <CoinRow key={coin.id} coin={coin} rank={i + 1} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

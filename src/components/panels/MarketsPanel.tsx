'use client';

import { ExternalLink, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useMarketData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { MarketQuote } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatPriceChange } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="flex items-center gap-3">
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-14 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
    </div>
  );
}

/* ─── Quote Row ─── */

function QuoteRow({ quote }: { quote: MarketQuote }) {
  const { text, color } = formatPriceChange(quote.changePct);
  const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}`;

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `Analyze ${quote.name} (${quote.symbol}) at $${formatCurrency(quote.price)} (${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%). What's driving this move and what are the implications?`,
          {
            sourcePanel: 'markets',
            dataType: 'market_quote',
            trendData: {
              symbol: quote.symbol,
              price: quote.price,
              change: quote.change,
              changePct: quote.changePct,
              volume: quote.volume,
              sourceUrl: yahooUrl,
            },
          },
        )
      }
      className="flex items-center justify-between py-1 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] cursor-pointer text-left w-full"
    >
      {/* Symbol & Name */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[var(--text-xs)] font-mono font-semibold text-[var(--text-primary)] shrink-0">
          {quote.symbol}
        </span>
        <span className="markets-quote-name text-[var(--text-xs)] font-mono text-[var(--text-dim)] truncate">
          {quote.name}
        </span>
      </div>

      {/* Price & Change */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[var(--text-xs)] font-mono text-[var(--text-primary)] tabular-nums">
          {formatCurrency(quote.price)}
        </span>

        {/* Sparkline placeholder bar */}
        <div className="w-12 h-2 rounded-full overflow-hidden bg-[var(--bg-hover)]">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              color === 'positive' && 'bg-[var(--color-positive)]',
              color === 'negative' && 'bg-[var(--color-negative)]',
              color === 'neutral' && 'bg-[var(--text-muted)]',
            )}
            style={{ width: `${Math.min(Math.abs(quote.changePct) * 10, 100)}%` }}
          />
        </div>

        {/* Change % */}
        <div className="flex items-center gap-1 min-w-[60px] justify-end">
          {color === 'positive' ? (
            <TrendingUp size={10} className="text-[var(--color-positive)]" />
          ) : color === 'negative' ? (
            <TrendingDown size={10} className="text-[var(--color-negative)]" />
          ) : (
            <Minus size={10} className="text-[var(--text-muted)]" />
          )}
          <span
            className={cn(
              'text-[var(--text-xs)] font-mono font-medium tabular-nums',
              color === 'positive' && 'text-[var(--color-positive)]',
              color === 'negative' && 'text-[var(--color-negative)]',
              color === 'neutral' && 'text-[var(--text-muted)]',
            )}
          >
            {text}
          </span>
        </div>

        {/* External link */}
        <a
          href={yahooUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors"
        >
          <ExternalLink size={10} />
        </a>
      </div>
    </button>
  );
}

/* ─── Section Header ─── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1 first:pt-0">
      <span className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em] text-[var(--text-dim)]">
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--border-subtle)]" />
    </div>
  );
}

/* ─── MarketsPanel ─── */

export function MarketsPanel() {
  const { isLoading } = useMarketData();
  const indices = useDataStore((s) => s.indices);
  const commodities = useDataStore((s) => s.commodities);

  const hasData = indices.length > 0 || commodities.length > 0;

  return (
    <PanelShell id="markets" title="MARKETS" span={2}>
      <style>{`.markets-quote-name { display: none; } @container (min-width: 380px) { .markets-quote-name { display: inline; } }`}</style>
      {isLoading && !hasData ? (
        <div className="space-y-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No market data available
          </span>
        </div>
      ) : (
        <div className="space-y-0.5">
          {/* Indices */}
          {indices.length > 0 && (
            <>
              <SectionHeader label="Indices" />
              {indices.map((q) => (
                <QuoteRow key={q.symbol} quote={q} />
              ))}
            </>
          )}

          {/* Commodities */}
          {commodities.length > 0 && (
            <>
              <SectionHeader label="Commodities" />
              {commodities.map((q) => (
                <QuoteRow key={q.symbol} quote={q} />
              ))}
            </>
          )}
        </div>
      )}
    </PanelShell>
  );
}

'use client';

import { ExternalLink } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { usePredictionData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { PredictionMarket } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatCompact } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Shimmer ─── */

function ShimmerItem() {
  return (
    <div className="py-2 px-1 space-y-1.5">
      <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-2 w-full animate-pulse rounded-full bg-[var(--bg-hover)]" />
      <div className="h-2.5 w-20 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── Probability Bar ─── */

function ProbabilityBar({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  const barColor =
    pct >= 70
      ? 'bg-[var(--color-positive)]'
      : pct >= 40
        ? 'bg-[var(--color-warning)]'
        : 'bg-[var(--color-negative)]';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--bg-hover)]">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          'text-[var(--text-xs)] font-mono font-semibold tabular-nums shrink-0 min-w-[32px] text-right',
          pct >= 70 && 'text-[var(--color-positive)]',
          pct >= 40 && pct < 70 && 'text-[var(--color-warning)]',
          pct < 40 && 'text-[var(--color-negative)]',
        )}
      >
        {pct}%
      </span>
    </div>
  );
}

/* ─── Market Item ─── */

function MarketItem({ market }: { market: PredictionMarket }) {
  const pct = Math.round(market.probability * 100);

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `What's the significance of "${market.question}" at ${pct}% probability? What factors could shift this?`,
          {
            sourcePanel: 'polymarket',
            dataType: 'prediction_market',
            trendData: {
              question: market.question,
              probability: market.probability,
              volume: market.volume,
              category: market.category,
              endDate: market.endDate,
              sourceUrl: market.url,
            },
          },
        )
      }
      className="py-1.5 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] cursor-pointer text-left w-full"
    >
      {/* Question + external link */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[var(--text-xs)] leading-tight text-[var(--text-primary)] line-clamp-2 mb-1">
          {market.question}
        </p>
        {market.url && (
          <a
            href={market.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors shrink-0 mt-0.5"
          >
            <ExternalLink size={10} />
          </a>
        )}
      </div>

      {/* Probability bar */}
      <ProbabilityBar probability={market.probability} />

      {/* Meta info */}
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-dim)]">
          {market.category}
        </span>
        <span className="text-[9px] text-[var(--text-muted)]">&middot;</span>
        <span className="text-[9px] font-mono text-[var(--text-muted)] tabular-nums">
          Vol: ${formatCompact(market.volume)}
        </span>
        {market.endDate && (
          <>
            <span className="text-[9px] text-[var(--text-muted)]">&middot;</span>
            <span className="text-[9px] font-mono text-[var(--text-muted)]">
              Ends{' '}
              {new Date(market.endDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

/* ─── PolymarketPanel ─── */

export function PolymarketPanel() {
  const { isLoading } = usePredictionData();
  const predictionMarkets = useDataStore((s) => s.predictionMarkets);

  // Sort by volume descending
  const sorted = [...predictionMarkets].sort((a, b) => b.volume - a.volume);
  const hasData = sorted.length > 0;

  return (
    <PanelShell id="polymarket" title="PREDICTION MARKETS" span={2}>
      {isLoading && !hasData ? (
        <div className="space-y-0.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerItem key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No prediction market data available
          </span>
        </div>
      ) : (
        <div className="space-y-0.5 divide-y divide-[var(--border-subtle)]">
          {sorted.map((market) => (
            <MarketItem key={market.id || market.question.slice(0, 30)} market={market} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

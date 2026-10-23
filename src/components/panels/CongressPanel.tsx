'use client';

import { ExternalLink } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useCongressData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { CongressTrade } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const PARTY_COLORS: Record<string, string> = {
  D: 'bg-blue-500',
  R: 'bg-red-500',
  I: 'bg-gray-400',
};

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="flex items-center justify-between py-1.5 px-1">
      <div className="flex items-center gap-2">
        <div className="h-3.5 w-3.5 animate-pulse rounded-full bg-[var(--bg-hover)]" />
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-3 w-10 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-14 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
    </div>
  );
}

/* ─── Trade Row ─── */

function TradeRow({ trade }: { trade: CongressTrade }) {
  const isSale = trade.transactionType.startsWith('Sale');

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `What does ${trade.member}'s ${trade.transactionType.toLowerCase()} of ${trade.symbol} for ${trade.amount} suggest? Any pattern with other congressional trades?`,
          {
            sourcePanel: 'congress',
            dataType: 'congress_trade',
            trendData: {
              member: trade.member,
              party: trade.party,
              chamber: trade.chamber,
              symbol: trade.symbol,
              transactionType: trade.transactionType,
              amount: trade.amount,
              filedDate: trade.filedDate,
              sourceUrl: trade.url,
            },
          },
        )
      }
      className="flex items-center justify-between py-1 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] cursor-pointer text-left w-full"
    >
      {/* Left: party badge + member */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-mono font-bold text-white',
            PARTY_COLORS[trade.party] ?? 'bg-gray-400',
          )}
        >
          {trade.party}
        </span>
        <span className="text-[var(--text-xs)] font-mono text-[var(--text-primary)] truncate">
          {trade.member}
        </span>
      </div>

      {/* Right: symbol, type, amount, date, link */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[var(--text-xs)] font-mono font-bold text-[var(--text-primary)] tabular-nums">
          {trade.symbol}
        </span>

        <span
          className={cn(
            'text-[9px] font-mono font-medium px-1.5 py-0.5 rounded',
            isSale
              ? 'text-[var(--color-negative)] bg-[var(--color-negative)]/10'
              : 'text-[var(--color-positive)] bg-[var(--color-positive)]/10',
          )}
        >
          {isSale ? 'SELL' : 'BUY'}
        </span>

        <span className="text-[var(--text-xs)] font-mono text-[var(--text-secondary)] tabular-nums min-w-[60px] text-right">
          {trade.amount}
        </span>

        <span className="text-[9px] font-mono text-[var(--text-muted)] shrink-0 min-w-[54px] text-right">
          {formatRelativeTime(trade.filedDate)}
        </span>

        {/* External link */}
        {trade.url && (
          <a
            href={trade.url}
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

/* ─── CongressPanel ─── */

export function CongressPanel() {
  const { isLoading } = useCongressData();
  const congressTrades = useDataStore((s) => s.congressTrades);

  const hasData = congressTrades.length > 0;

  return (
    <PanelShell id="congress" title="CONGRESS TRADES" span={1}>
      {isLoading && !hasData ? (
        <div className="space-y-0.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No congressional trades available
          </span>
        </div>
      ) : (
        <div className="space-y-0">
          {/* Column headers */}
          <div className="flex items-center justify-between px-1 pb-1 border-b border-[var(--border-subtle)]">
            <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Member
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Ticker
              </span>
              <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Type
              </span>
              <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)] min-w-[60px] text-right">
                Amount
              </span>
              <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)] min-w-[54px] text-right">
                Filed
              </span>
            </div>
          </div>

          {/* Trade rows */}
          {congressTrades.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

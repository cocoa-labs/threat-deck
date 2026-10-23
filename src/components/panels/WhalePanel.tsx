'use client';

import { ArrowRight, ExternalLink } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useWhaleData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { WhaleTransaction } from '@/lib/types';
import { formatCompact, formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const CHAIN_COLORS: Record<string, string> = {
  bitcoin: '#f7931a',
  ethereum: '#627eea',
  solana: '#00ffa3',
  tron: '#ff0013',
  ripple: '#00aae4',
  polygon: '#8247e5',
  avalanche: '#e84142',
  cardano: '#0033ad',
};

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ─── Shimmer ─── */

function ShimmerItem() {
  return (
    <div className="flex items-start gap-2 py-1.5 px-1">
      <div className="h-5 w-5 animate-pulse rounded-full bg-[var(--bg-hover)] shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-2.5 w-3/4 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
    </div>
  );
}

/* ─── Whale Item ─── */

function WhaleItem({ tx }: { tx: WhaleTransaction }) {
  const chainColor = CHAIN_COLORS[tx.blockchain.toLowerCase()] ?? 'var(--text-dim)';

  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `Analyze this ${tx.blockchain} whale transfer of ${formatCompact(tx.amount)} ${tx.symbol} ($${formatCompact(tx.amountUsd)}) from ${tx.from} to ${tx.to}. Is this significant?`,
          {
            sourcePanel: 'whales',
            dataType: 'whale_transaction',
            trendData: {
              blockchain: tx.blockchain,
              symbol: tx.symbol,
              amount: tx.amount,
              amountUsd: tx.amountUsd,
              from: tx.from,
              to: tx.to,
              timestamp: tx.timestamp,
              sourceUrl: tx.url,
            },
          },
        )
      }
      className="flex items-start gap-2 py-1.5 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] cursor-pointer text-left w-full"
    >
      {/* Chain icon */}
      <div
        className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center mt-0.5"
        style={{ backgroundColor: `${chainColor}20`, border: `1px solid ${chainColor}40` }}
      >
        <span className="text-[6px] font-mono font-bold uppercase" style={{ color: chainColor }}>
          {tx.blockchain.slice(0, 3)}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[var(--text-xs)] font-mono font-semibold text-[var(--text-primary)] tabular-nums">
              {formatCompact(tx.amount)} {tx.symbol}
            </span>
            <span className="text-[9px] font-mono text-[var(--text-dim)]">
              (${formatCompact(tx.amountUsd)})
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <span className="text-[9px] font-mono text-[var(--text-muted)]">
              {formatRelativeTime(tx.timestamp)}
            </span>
            {tx.url && (
              <a
                href={tx.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors"
              >
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>

        {/* From -> To */}
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[9px] font-mono text-[var(--text-dim)] truncate">
            {truncateAddress(tx.from)}
          </span>
          <ArrowRight size={8} className="text-[var(--text-muted)] shrink-0" />
          <span className="text-[9px] font-mono text-[var(--text-dim)] truncate">
            {truncateAddress(tx.to)}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ─── WhalePanel ─── */

export function WhalePanel() {
  const { isLoading } = useWhaleData();
  const whaleTransactions = useDataStore((s) => s.whaleTransactions);

  const hasData = whaleTransactions.length > 0;

  return (
    <PanelShell id="whales" title="WHALE WATCH" span={1}>
      {isLoading && !hasData ? (
        <div className="space-y-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <ShimmerItem key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No whale transactions detected
          </span>
        </div>
      ) : (
        <div className="space-y-0">
          {whaleTransactions.map((tx) => (
            <WhaleItem key={tx.id} tx={tx} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

'use client';

import { Building2, ExternalLink } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useGovernmentData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { GovernmentContract } from '@/lib/types';
import { formatDate, formatLargeCurrency } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="py-2 px-1 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <div className="h-2.5 w-full animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-2 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── Contract Row ─── */

function ContractRow({ contract }: { contract: GovernmentContract }) {
  return (
    <button
      type="button"
      onClick={() =>
        prefillAgent(
          `Analyze this ${contract.agency} contract to ${contract.contractor} for ${formatLargeCurrency(contract.amount)}. Description: "${contract.description}". What are the strategic implications?`,
          {
            sourcePanel: 'contracts',
            dataType: 'government_contract',
            trendData: {
              agency: contract.agency,
              contractor: contract.contractor,
              amount: contract.amount,
              description: contract.description,
              awardDate: contract.awardDate,
              sourceUrl: contract.url,
            },
          },
        )
      }
      className="py-1.5 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] cursor-pointer text-left w-full"
    >
      {/* Agency & Amount */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono font-semibold uppercase tracking-wider text-[var(--text-dim)] truncate min-w-0">
          {contract.agency}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[var(--text-xs)] font-mono font-bold text-[var(--color-positive)] tabular-nums">
            {formatLargeCurrency(contract.amount)}
          </span>
          {contract.url && (
            <a
              href={contract.url}
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

      {/* Contractor */}
      <span className="text-[var(--text-xs)] font-mono font-semibold text-[var(--text-primary)] block mt-0.5 truncate">
        {contract.contractor}
      </span>

      {/* Description (truncated) */}
      <p className="text-[9px] font-mono text-[var(--text-dim)] line-clamp-1 mt-0.5">
        {contract.description}
      </p>

      {/* Award date */}
      <span className="text-[8px] font-mono text-[var(--text-muted)] mt-0.5 block">
        Awarded {formatDate(contract.awardDate)}
      </span>
    </button>
  );
}

/* ─── ContractsPanel ─── */

export function ContractsPanel() {
  const { isLoading } = useGovernmentData();
  const governmentContracts = useDataStore((s) => s.governmentContracts);

  const hasData = governmentContracts.length > 0;

  return (
    <PanelShell id="contracts" title="GOV CONTRACTS" span={2}>
      {isLoading && !hasData ? (
        <div className="space-y-0.5 divide-y divide-[var(--border-subtle)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerRow key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <Building2 size={16} className="text-[var(--text-muted)]" />
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              No government contract data available
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5 divide-y divide-[var(--border-subtle)]">
          {governmentContracts.map((contract) => (
            <ContractRow key={contract.id} contract={contract} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

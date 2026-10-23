'use client';

interface Props {
  contractor: string;
  agency?: string;
  contractAmount?: number;
}

export function TooltipContract({ contractor, agency, contractAmount }: Props) {
  return (
    <div className="mt-1.5 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
      <p>
        <span className="text-[var(--text-muted)]">Contractor:</span> {contractor}
      </p>
      {agency && (
        <p>
          <span className="text-[var(--text-muted)]">Agency:</span> {agency}
        </p>
      )}
      {contractAmount != null && (
        <p>
          <span className="text-[var(--text-muted)]">Value:</span> $
          {(contractAmount / 1_000_000).toFixed(1)}M
        </p>
      )}
    </div>
  );
}

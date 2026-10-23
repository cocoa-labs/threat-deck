'use client';

interface Props {
  txSymbol: string;
  blockchain?: string;
  amountUsd?: number;
  fromAddress?: string;
  toAddress?: string;
}

export function TooltipWhale({ txSymbol, blockchain, amountUsd, fromAddress, toAddress }: Props) {
  return (
    <div className="mt-1.5 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
      <p>
        <span className="text-[var(--text-muted)]">Asset:</span> {txSymbol}
        {blockchain && ` on ${blockchain}`}
      </p>
      {amountUsd != null && (
        <p>
          <span className="text-[var(--text-muted)]">Value:</span> $
          {(amountUsd / 1_000_000).toFixed(1)}M
        </p>
      )}
      {fromAddress && (
        <p className="truncate">
          <span className="text-[var(--text-muted)]">From:</span> {fromAddress}
        </p>
      )}
      {toAddress && (
        <p className="truncate">
          <span className="text-[var(--text-muted)]">To:</span> {toAddress}
        </p>
      )}
    </div>
  );
}

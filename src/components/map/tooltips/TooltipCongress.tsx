'use client';

interface Props {
  member: string;
  party?: string;
  chamber?: string;
  transactionType?: string;
  tradeSymbol?: string;
  tradeAmount?: string;
}

export function TooltipCongress({
  member,
  party,
  chamber,
  transactionType,
  tradeSymbol,
  tradeAmount,
}: Props) {
  return (
    <div className="mt-1.5 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
      <p>
        <span className="text-[var(--text-muted)]">Member:</span> {member}
        {party && ` (${party}`}
        {chamber && `-${chamber})`}
      </p>
      {transactionType && (
        <p>
          <span className="text-[var(--text-muted)]">Trade:</span> {transactionType}{' '}
          {tradeSymbol && tradeSymbol}
          {tradeAmount && ` — ${tradeAmount}`}
        </p>
      )}
    </div>
  );
}

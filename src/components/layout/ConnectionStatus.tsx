'use client';

import { useConnectionStore } from '@/lib/store/connection-store';

export function ConnectionStatus() {
  const mode = useConnectionStore((s) => s.mode);

  if (mode === 'live') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-positive)] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-positive)]" />
        </span>
        <span
          className="text-[10px] font-mono font-semibold tracking-wider"
          style={{ color: 'var(--color-positive)' }}
        >
          LIVE
        </span>
      </div>
    );
  }

  // REST mode: data flowing via polling — subtle, not alarming
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-positive)]" />
      </span>
      <span
        className="text-[10px] font-mono font-semibold tracking-wider"
        style={{ color: 'var(--color-positive)' }}
      >
        REST
      </span>
    </div>
  );
}

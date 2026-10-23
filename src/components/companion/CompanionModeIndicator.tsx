'use client';

import { useCompanionStore } from '@/lib/store/companion-store';

export function CompanionModeIndicator() {
  const isActive = useCompanionStore((s) => s.isActive);

  if (!isActive) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded px-2 py-1 font-mono"
      style={{
        top: 12,
        zIndex: 51,
        background: 'var(--crt-panel-bg)',
        border: '1px solid rgba(var(--crt-glow-rgb), 0.2)',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full animate-pulse"
        style={{
          background: 'var(--crt-glow)',
          boxShadow: '0 0 6px var(--crt-glow)',
        }}
      />
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.15em]"
        style={{
          color: 'var(--crt-glow)',
          textShadow: '0 0 8px rgba(var(--crt-glow-rgb), 0.25)',
        }}
      >
        Companion
      </span>
    </div>
  );
}

'use client';

import { AlertTriangle, Info, ShieldAlert, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { CompanionToastItem } from '@/lib/store/companion-store';
import { useCompanionStore } from '@/lib/store/companion-store';

const SEVERITY_CONFIG: Record<
  CompanionToastItem['severity'],
  { icon: typeof Zap; color: string; autoDismissMs: number | null }
> = {
  critical: { icon: ShieldAlert, color: 'var(--severity-critical)', autoDismissMs: null },
  high: { icon: AlertTriangle, color: 'var(--severity-high)', autoDismissMs: 15_000 },
  medium: { icon: Zap, color: 'var(--severity-medium)', autoDismissMs: 10_000 },
  info: { icon: Info, color: 'var(--severity-info)', autoDismissMs: 8_000 },
};

function CompanionToastCard({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: CompanionToastItem;
  onDismiss: (id: string) => void;
  onOpen: () => void;
}) {
  const config = SEVERITY_CONFIG[toast.severity];
  const Icon = config.icon;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (config.autoDismissMs) {
      timerRef.current = setTimeout(() => onDismiss(toast.id), config.autoDismissMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, config.autoDismissMs, onDismiss]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: intentional div[role=button] — contains nested <button> (dismiss), cannot use <button> per HTML spec (BUG-007)
    <div
      role="button"
      tabIndex={0}
      className="flex items-start gap-2 p-3 rounded border cursor-pointer animate-[crt-data-enter_300ms_ease-out] text-left"
      style={{
        background: 'var(--bg-surface)',
        borderColor: `color-mix(in srgb, ${config.color} 40%, transparent)`,
        boxShadow: `0 0 8px color-mix(in srgb, ${config.color} 20%, transparent)`,
        width: 'var(--companion-toast-width, 320px)',
      }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Icon size={16} style={{ color: config.color, flexShrink: 0, marginTop: 2 }} />
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-mono font-semibold leading-tight truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {toast.title}
        </div>
        <div
          className="text-[10px] font-mono mt-0.5 line-clamp-2"
          style={{ color: 'var(--text-dim)' }}
        >
          {toast.content}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        className="text-[var(--text-dim)] hover:text-[var(--text-primary)] flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function CompanionToast() {
  const toasts = useCompanionStore((s) => s.companionToasts);
  const dismissToast = useCompanionStore((s) => s.dismissCompanionToast);
  const setSidebarOpen = useCompanionStore((s) => s.setSidebarOpen);

  const handleOpen = useCallback(() => {
    setSidebarOpen(true);
  }, [setSidebarOpen]);

  const visible = toasts.filter((t) => !t.dismissed);

  if (visible.length === 0) return null;

  return (
    <div
      className="fixed flex flex-col gap-2 pointer-events-auto"
      style={{
        top: 16,
        right: 16,
        zIndex: 52,
      }}
    >
      {visible.slice(0, 3).map((t) => (
        <CompanionToastCard key={t.id} toast={t} onDismiss={dismissToast} onOpen={handleOpen} />
      ))}
    </div>
  );
}

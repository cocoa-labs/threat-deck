'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePanelsStore } from '@/lib/store/panels-store';

interface ColumnExpandTabProps {
  side: 'left' | 'right';
}

export function ColumnExpandTab({ side }: ColumnExpandTabProps) {
  const collapsed = usePanelsStore((s) =>
    side === 'left' ? s.leftColumnCollapsed : s.rightColumnCollapsed,
  );
  const toggle = usePanelsStore((s) =>
    side === 'left' ? s.toggleLeftColumn : s.toggleRightColumn,
  );

  if (!collapsed) return null;

  const isLeft = side === 'left';
  const shortcut = isLeft ? '\u2318[' : '\u2318]';

  return (
    <button
      type="button"
      onClick={toggle}
      className="column-expand-tab absolute top-1/2 -translate-y-1/2 flex items-center justify-center transition-all hover:scale-105"
      style={{
        [isLeft ? 'left' : 'right']: 4,
        zIndex: 10,
        width: 24,
        height: 48,
        background: 'rgba(10, 10, 10, 0.85)',
        border: '1px solid rgba(var(--crt-glow-rgb), 0.3)',
        borderRadius: isLeft ? '0 6px 6px 0' : '6px 0 0 6px',
        color: 'var(--crt-glow)',
        pointerEvents: 'auto',
      }}
      aria-label={`Expand ${side} column (${shortcut})`}
      title={`Expand ${side} column (${shortcut})`}
    >
      {isLeft ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
    </button>
  );
}

'use client';

import React, { createContext, useContext } from 'react';
import { PANEL_COMPONENTS } from '@/components/panels/panel-registry';
import { usePanelsStore } from '@/lib/store/panels-store';
import type { SlotId } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

/* ─── Slot context — lets PanelShell know which slot it's in ─── */

const SlotContext = createContext<SlotId | undefined>(undefined);

export function useSlotId() {
  return useContext(SlotContext);
}

/* ─── PanelSlot ─── */

interface PanelSlotProps {
  slotId: SlotId;
  className?: string;
}

export const PanelSlot = React.memo(
  function PanelSlot({ slotId, className }: PanelSlotProps) {
    const panelId = usePanelsStore((s) => s.slotAssignments[slotId]);
    const Component = panelId ? PANEL_COMPONENTS[panelId] : undefined;

    if (!Component) {
      return (
        <div
          className={cn(
            'flex flex-col min-h-0 min-w-0 h-full items-center justify-center',
            className,
          )}
          style={{ containerType: 'inline-size', contain: 'layout style' }}
        >
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            Empty slot
          </span>
        </div>
      );
    }

    return (
      <SlotContext.Provider value={slotId}>
        <div
          key={panelId}
          className={cn('flex flex-col min-h-0 min-w-0 h-full', className)}
          style={{ containerType: 'inline-size', contain: 'layout style' }}
        >
          <Component />
        </div>
      </SlotContext.Provider>
    );
  },
  (prev, next) => prev.slotId === next.slotId && prev.className === next.className,
);

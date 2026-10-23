'use client';

import { useCallback } from 'react';
import { usePanelsStore } from '@/lib/store/panels-store';
import type { PanelId } from '@/lib/types';

export function usePanelLayout() {
  const store = usePanelsStore();

  const visiblePanels: Set<PanelId> = store.visiblePanels;

  const togglePanel = useCallback(
    (id: PanelId) => {
      store.togglePanel(id);
    },
    [store],
  );

  const collapsePanel = useCallback(
    (id: PanelId) => {
      store.toggleCollapse(id);
    },
    [store],
  );

  const movePanel = useCallback(
    (id: PanelId, direction: 'up' | 'down') => {
      const order = [...store.panelOrder];
      const index = order.indexOf(id);
      if (index === -1) return;

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= order.length) return;

      // Swap with adjacent panel
      const adjacent = order[targetIndex];
      if (adjacent === undefined) return;
      order[targetIndex] = id;
      order[index] = adjacent;

      store.reorderPanels(order);
    },
    [store],
  );

  const resetLayout = useCallback(() => {
    store.resetToDefaults();
  }, [store]);

  return {
    visiblePanels,
    togglePanel,
    collapsePanel,
    movePanel,
    resetLayout,
  };
}

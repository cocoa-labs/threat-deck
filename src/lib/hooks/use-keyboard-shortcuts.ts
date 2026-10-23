'use client';

import { useEffect } from 'react';
import { useCompanionStore } from '@/lib/store/companion-store';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';
import { PANEL_CONFIGS, usePanelsStore } from '@/lib/store/panels-store';

interface KeyboardShortcutsConfig {
  enabled?: boolean;
}

export function useKeyboardShortcuts(config: KeyboardShortcutsConfig = {}) {
  const { enabled = true } = config;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K: Toggle command palette
      if (mod && e.key === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-command-palette'));
        return;
      }

      // Cmd/Ctrl+B: Toggle sidebar
      if (mod && e.key === 'b') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-sidebar'));
        return;
      }

      // Cmd/Ctrl+[: Toggle left column
      if (mod && e.key === '[') {
        e.preventDefault();
        usePanelsStore.getState().toggleLeftColumn();
        return;
      }

      // Cmd/Ctrl+]: Toggle right column
      if (mod && e.key === ']') {
        e.preventDefault();
        usePanelsStore.getState().toggleRightColumn();
        return;
      }

      // Cmd/Ctrl+/: Toggle companion sidebar (only when companion is active)
      if (mod && e.key === '/') {
        e.preventDefault();
        const { isActive, toggleSidebar } = useCompanionStore.getState();
        if (isActive) toggleSidebar();
        return;
      }

      // Cmd/Ctrl+.: Focus companion chat input
      if (mod && e.key === '.') {
        e.preventDefault();
        const { isActive, sidebarOpen, setSidebarOpen } = useCompanionStore.getState();
        if (isActive) {
          if (!sidebarOpen) setSidebarOpen(true);
          setTimeout(() => {
            const input = document.getElementById('companion-chat-input');
            input?.focus();
          }, 50);
        }
        return;
      }

      // Escape: Layered dismissal — hover cards first, then globe selection
      if (e.key === 'Escape') {
        const {
          hoveredMarkerId,
          hoveredClusterData,
          hoverMarker,
          setHoveredClusterData,
          setHoverLocked,
        } = useMapStore.getState();
        if (hoveredMarkerId || hoveredClusterData) {
          hoverMarker(null);
          setHoveredClusterData(null);
          setHoverLocked(false);
          return;
        }
        useGlobeStore.getState().selectMarker(null);
        useGlobeStore.getState().resetCamera();
        return;
      }

      // 1-9: Quick switch visible panels
      if (!mod && !e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key, 10) - 1;
        const panelConfig = PANEL_CONFIGS[index];
        if (panelConfig) {
          usePanelsStore.getState().togglePanel(panelConfig.id);
        }
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}

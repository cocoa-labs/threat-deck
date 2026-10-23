'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PANEL_SECTIONS } from '@/components/panels/panel-registry';
import { PANEL_CONFIGS, usePanelsStore } from '@/lib/store/panels-store';
import type { PanelId, SlotId } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

interface ChannelSelectorProps {
  slotId: SlotId;
  currentPanelId: PanelId;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

const SLOT_LABELS: Record<SlotId, string> = {
  'left-1': 'L1',
  'right-1': 'R1',
  'right-2': 'R2',
  'bottom-1': 'B1',
  'bottom-2': 'B2',
  'grid-1': 'G1',
  'grid-2': 'G2',
  'grid-3': 'G3',
  'grid-4': 'G4',
  'grid-5': 'G5',
  'grid-6': 'G6',
  'grid-7': 'G7',
  'grid-8': 'G8',
  'grid-9': 'G9',
  'grid-10': 'G10',
  'grid-11': 'G11',
  'grid-12': 'G12',
};

export function ChannelSelector({
  slotId,
  currentPanelId,
  anchorRef,
  onClose,
}: ChannelSelectorProps) {
  const assignPanelToSlot = usePanelsStore((s) => s.assignPanelToSlot);
  const slotAssignments = usePanelsStore((s) => s.slotAssignments);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number }>({
    top: 0,
    left: 0,
    maxHeight: 480,
  });

  // Stable ref for onClose to avoid re-running the scroll effect
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Position the dropdown below the anchor and track scroll/resize
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const main = document.querySelector('main');
    let rafId = 0;

    const COMMAND_BAR_HEIGHT = 48;
    const PADDING = 8;
    const MIN_MAX_HEIGHT = 120;
    const MAX_MAX_HEIGHT = 480;

    function updatePosition() {
      const anchorRect = anchor!.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect();
      const boundaryBottom = mainRect
        ? mainRect.bottom - COMMAND_BAR_HEIGHT - PADDING
        : window.innerHeight - COMMAND_BAR_HEIGHT - PADDING;
      const boundaryTop = mainRect ? mainRect.top : 0;

      // Auto-close if trigger scrolled out of visible area
      if (anchorRect.bottom < boundaryTop || anchorRect.top > boundaryBottom) {
        onCloseRef.current();
        return;
      }

      const top = anchorRect.bottom + 4;
      const left = anchorRect.left;
      const available = boundaryBottom - top;
      const maxHeight = Math.max(MIN_MAX_HEIGHT, Math.min(MAX_MAX_HEIGHT, available));

      setPos({ top, left, maxHeight });
    }

    function onScrollOrResize() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updatePosition);
    }

    // Initial position
    updatePosition();

    main?.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      cancelAnimationFrame(rafId);
      main?.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [anchorRef]);

  // Close on Escape or click outside
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleClickOutside(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose, anchorRef]);

  // Find which slot each panelId is currently assigned to
  const panelToSlot = new Map<PanelId, SlotId>();
  for (const [sid, pid] of Object.entries(slotAssignments)) {
    panelToSlot.set(pid as PanelId, sid as SlotId);
  }

  function handleSelect(panelId: PanelId) {
    assignPanelToSlot(slotId, panelId);
    onClose();
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed w-56 overflow-y-auto border border-[rgba(var(--crt-glow-rgb),0.2)] bg-[var(--bg-surface)] shadow-lg"
      style={{
        zIndex: 'var(--z-tooltip)',
        top: pos.top,
        left: pos.left,
        maxHeight: pos.maxHeight,
      }}
    >
      {PANEL_SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="sticky top-0 px-3 py-1.5 text-[8px] font-mono font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {section.label}
          </div>
          {section.panelIds.map((panelId) => {
            const config = PANEL_CONFIGS.find((c) => c.id === panelId);
            if (!config) return null;

            const isCurrent = panelId === currentPanelId;
            const assignedSlot = panelToSlot.get(panelId);
            const isElsewhere = assignedSlot && assignedSlot !== slotId;

            return (
              <button
                type="button"
                key={panelId}
                onClick={() => handleSelect(panelId)}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors',
                  isCurrent
                    ? 'bg-[rgba(var(--crt-glow-rgb),0.1)] text-[var(--crt-glow)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                )}
              >
                <span className="text-[10px] font-mono">{config.title}</span>
                {isElsewhere && (
                  <span className="text-[8px] font-mono text-[var(--text-muted)]">
                    ({SLOT_LABELS[assignedSlot]})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}

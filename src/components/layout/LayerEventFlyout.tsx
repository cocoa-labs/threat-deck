'use client';

import { type RefObject, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CyberMarkerDetails } from '@/components/cyber/CyberMarkerDetails';
import { GenericMarkerCard } from '@/components/layout/GenericMarkerCard';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import type { GlobeMarker } from '@/lib/types';
import { isCyberMarker } from '@/lib/utils/cyber-markers';

interface LayerEventFlyoutProps {
  marker: GlobeMarker;
  pinned: boolean;
  position: { left: number; top: number };
  flyoutRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onAnalyze: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Row-anchored detail card for the LAYER INTELLIGENCE drawer's TOP EVENTS list.
 *
 * Portaled to #map-popup-portal so it escapes the drawer's overflow clip and sits
 * to the RIGHT of the drawer (position is computed by the parent from the hovered
 * row's rect). Pure presentational leaf — the parent owns hover/pin state, the
 * dismiss timer, and the store hover-mirror. The mouse handlers here only feed the
 * parent's hover bridge so moving row → card keeps the card alive.
 */
export function LayerEventFlyout({
  marker,
  pinned,
  position,
  flyoutRef,
  onClose,
  onAnalyze,
  onMouseEnter,
  onMouseLeave,
}: LayerEventFlyoutProps) {
  const portalEl = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return document.getElementById('map-popup-portal') as HTMLDivElement | null;
  }, []);

  if (!portalEl) return null;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: hover bridge for the row→card dismiss timer
    <div
      ref={flyoutRef}
      className="pointer-events-auto absolute"
      style={{ left: position.left, top: position.top, zIndex: 53 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
        {isCyberMarker(marker) ? (
          <CyberMarkerDetails
            marker={marker}
            variant="compact"
            onAnalyze={onAnalyze}
            onClose={pinned ? onClose : undefined}
            analyzeLabel={AGENT_IDENTITY.askLabel}
          />
        ) : (
          <GenericMarkerCard
            marker={marker}
            onAnalyze={onAnalyze}
            onClose={pinned ? onClose : undefined}
            analyzeLabel={AGENT_IDENTITY.askLabel}
          />
        )}
      </div>
    </div>,
    portalEl,
  );
}

'use client';

import type { GeoJSONSource } from 'mapbox-gl';
import { useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-map-gl/mapbox';
import { CyberMarkerDetails } from '@/components/cyber/CyberMarkerDetails';
import { analyzeMarker, GenericMarkerCard } from '@/components/layout/GenericMarkerCard';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { type UnifiedMarkerResult, useUnifiedMarker } from '@/lib/hooks/use-unified-marker';
import { useAgentStore } from '@/lib/store/agent-store';
import { useMapStore } from '@/lib/store/map-store';
import type { Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { isCyberMarker } from '@/lib/utils/cyber-markers';
import { prefillAgent } from '@/lib/utils/panel-actions';
import { ClusterCard } from './cards/ClusterCard';

// ─── Shared Constants ───

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

const POPUP_OFFSET = 14;
const SAFE_MARGIN = 16;
const DRAWER_WIDTH = 420;
const DRAWER_MARGIN = 16;

// ─── Safe-zone positioning ───

function computePosition(
  markerPx: { x: number; y: number },
  mapRect: DOMRect,
  popupWidth: number,
  popupHeight: number,
  drawerOpen: boolean,
) {
  const viewportX = mapRect.left + markerPx.x;
  const viewportY = mapRect.top + markerPx.y;

  const rightEdge = drawerOpen
    ? window.innerWidth - DRAWER_WIDTH - DRAWER_MARGIN
    : window.innerWidth - SAFE_MARGIN;
  const leftEdge = SAFE_MARGIN;
  const topEdge = SAFE_MARGIN;
  const bottomEdge = window.innerHeight - SAFE_MARGIN;

  let popupX = viewportX - popupWidth / 2;
  let popupY = viewportY - POPUP_OFFSET - popupHeight;
  let flippedBelow = false;

  if (popupX + popupWidth > rightEdge) popupX = rightEdge - popupWidth;
  if (popupX < leftEdge) popupX = leftEdge;

  if (popupY < topEdge) {
    popupY = viewportY + POPUP_OFFSET;
    flippedBelow = true;
  }

  if (flippedBelow && popupY + popupHeight > bottomEdge) {
    popupY = bottomEdge - popupHeight;
  }

  if (drawerOpen && viewportX > window.innerWidth - DRAWER_WIDTH) {
    popupX = Math.min(popupX, rightEdge - popupWidth);
  }

  return { x: popupX, y: popupY };
}

// ─── SingleMarkerCard ───

function SingleMarkerCard({ result }: { result: NonNullable<UnifiedMarkerResult> }) {
  const now = Date.now();
  const handleAskKlammer = useCallback(() => {
    if (result.type === 'agent') {
      const m = result.marker;
      prefillAgent(
        `Analyze Max intel: "${m.label}". ${m.description}. Provide context, implications, and actionable intelligence.`,
        {
          sourcePanel: 'map',
          dataType: 'agent_intel',
          trendData: {
            label: m.label,
            severity: m.severity,
            category: m.category,
            confidence: `${Math.round(m.confidence * 100)}%`,
          },
        },
      );
    } else {
      analyzeMarker(result.marker);
    }
  }, [result]);

  if (result.type === 'agent') {
    const m = result.marker;
    const badgeClasses = SEVERITY_BADGE[m.severity] ?? SEVERITY_BADGE.info;
    const elapsed = (now - m.createdAt) / 1000;
    const remaining = Math.max(0, m.ttl - elapsed);
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);

    return (
      <div className="p-3 min-w-[360px] max-w-[440px]">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{m.label}</h4>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
              badgeClasses,
            )}
          >
            {m.severity}
          </span>
          <span className="text-[9px] font-mono text-[var(--color-info)]">
            {Math.round(m.confidence * 100)}% confidence
          </span>
          <span className="text-[9px] font-mono text-[var(--text-muted)]">
            TTL: {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-dim)]">{m.description}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Max intel</span>
          <span className="text-[9px] font-mono uppercase text-[var(--text-dim)]">
            {m.category}
          </span>
        </div>
        <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={handleAskKlammer}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-info)]/20 bg-[var(--color-info)]/5 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/10"
          >
            {AGENT_IDENTITY.askLabel}
          </button>
        </div>
      </div>
    );
  }

  const { marker, hotspot } = result;

  if (isCyberMarker(marker)) {
    return (
      <CyberMarkerDetails
        marker={marker}
        variant="compact"
        onAnalyze={handleAskKlammer}
        analyzeLabel={AGENT_IDENTITY.askLabel}
      />
    );
  }

  return (
    <GenericMarkerCard
      marker={marker}
      hotspot={hotspot}
      onAnalyze={handleAskKlammer}
      analyzeLabel={AGENT_IDENTITY.askLabel}
    />
  );
}

// ─── Inner component that only renders when portal exists ───

function MapMarkerOverlayInner({ portalEl }: { portalEl: HTMLDivElement }) {
  const { current: mapInstance } = useMap();
  const cardRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hoveredMarkerId = useMapStore((s) => s.hoveredMarkerId);
  const hoverSource = useMapStore((s) => s.hoverSource);
  const hoverMarker = useMapStore((s) => s.hoverMarker);
  const hoveredClusterData = useMapStore((s) => s.hoveredClusterData);
  const setHoveredClusterData = useMapStore((s) => s.setHoveredClusterData);
  const setHoverLocked = useMapStore((s) => s.setHoverLocked);
  const viewState = useMapStore((s) => s.viewState);
  const viewMode = useMapStore((s) => s.viewMode);
  const drawerOpen = useAgentStore((s) => s.drawerOpen);

  const hoveredResult = useUnifiedMarker(hoveredMarkerId);

  // Sticky hover handlers for the card
  const handleCardMouseEnter = useCallback(() => {
    setHoverLocked(true);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [setHoverLocked]);

  const handleCardMouseLeave = useCallback(() => {
    setHoverLocked(false);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = setTimeout(() => {
      hoverMarker(null);
      setHoveredClusterData(null);
    }, 200);
  }, [hoverMarker, setHoveredClusterData, setHoverLocked]);

  // Cluster zoom-in handler
  const handleClusterZoomIn = useCallback(() => {
    if (!hoveredClusterData || !mapInstance) return;
    const map = mapInstance.getMap();
    const sourceId = viewMode === 'command' ? 'command-markers' : 'klammer-markers';
    const source = map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.getClusterExpansionZoom(
      hoveredClusterData.clusterId,
      (err?: Error | null, zoom?: number | null) => {
        if (err || zoom == null) return;
        map.easeTo({
          center: [hoveredClusterData.lon, hoveredClusterData.lat],
          zoom,
          duration: 500,
        });
      },
    );
    // Dismiss card after zoom
    hoverMarker(null);
    setHoveredClusterData(null);
    setHoverLocked(false);
  }, [
    hoveredClusterData,
    mapInstance,
    viewMode,
    hoverMarker,
    setHoveredClusterData,
    setHoverLocked,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewState triggers re-projection on pan/zoom
  const position = useMemo(() => {
    const map = mapInstance?.getMap();
    if (!map) return null;

    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();

    // News/intel cluster
    if (hoveredClusterData) {
      const px = map.project([hoveredClusterData.lon, hoveredClusterData.lat]);
      const w = cardRef.current?.offsetWidth ?? 440;
      const h = cardRef.current?.offsetHeight ?? 300;
      return computePosition(px, rect, w, h, drawerOpen);
    }

    if (hoveredResult) {
      const marker = hoveredResult.type === 'agent' ? hoveredResult.marker : hoveredResult.marker;
      const px = map.project([marker.lon, marker.lat]);
      const w = cardRef.current?.offsetWidth ?? 400;
      const h = cardRef.current?.offsetHeight ?? 200;
      return computePosition(px, rect, w, h, drawerOpen);
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewState intentionally triggers re-projection on pan/zoom
  }, [viewState, hoveredResult, hoveredClusterData, drawerOpen, mapInstance]);

  // A 'list' hover comes from a LAYER INTELLIGENCE drawer row — the row-anchored
  // LayerEventFlyout owns that card, so suppress the marker-anchored one here to
  // avoid a duplicate card appearing far away over the globe.
  const showMarkerCard = hoveredResult && !hoveredClusterData && hoverSource !== 'list';
  const showClusterCard = hoveredClusterData != null;

  if (!position || (!showMarkerCard && !showClusterCard)) return null;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for sticky card dismiss
    <div
      ref={cardRef}
      className="pointer-events-auto absolute"
      style={{ left: position.x, top: position.y, zIndex: 52 }}
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
    >
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg overflow-hidden">
        {showMarkerCard && <SingleMarkerCard result={hoveredResult} />}
        {showClusterCard && (
          <ClusterCard
            clusterId={hoveredClusterData.clusterId}
            pointCount={hoveredClusterData.pointCount}
            categories={hoveredClusterData.categories}
            onZoomIn={handleClusterZoomIn}
          />
        )}
      </div>
    </div>,
    portalEl,
  );
}

// ─── Main Overlay Component ───

export function MapMarkerOverlay() {
  const portalEl = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return document.getElementById('map-popup-portal') as HTMLDivElement | null;
  }, []);

  if (!portalEl) return null;

  return <MapMarkerOverlayInner portalEl={portalEl} />;
}

'use client';

import { ExternalLink, LocateFixed, RadioTower, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeMarker } from '@/components/layout/GenericMarkerCard';
import { LayerEventFlyout } from '@/components/layout/LayerEventFlyout';
import { getMapInstance } from '@/components/map/MapCanvas';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeLayer, GlobeMarker, Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import {
  buildLayerStats,
  CYBER_LAYER_LABELS,
  getMarkerSourceUrl,
  isCyberLayer,
  isCyberMarker,
  markersForLayer,
  markerVisibleForActiveLayers,
  sortTopEvents,
} from '@/lib/utils/cyber-markers';
import { prefillAgent } from '@/lib/utils/panel-actions';

/** Grace window (ms) after the cursor leaves a row before the flyout dismisses —
 *  long enough to travel from the row onto the card (the hover bridge). */
const GRACE_MS = 220;

const LAYER_LABELS: Partial<Record<GlobeLayer, string>> = {
  markers: 'Markers',
  threatRings: 'Threat Rings',
  heatmap: 'Heatmap',
  arcs: 'Arcs',
  conflictZones: 'Conflict Zones',
  militaryBases: 'Military',
  infrastructure: 'Infrastructure',
  agentActivity: 'Max Activity',
  dayNight: 'Day / Night',
  ...CYBER_LAYER_LABELS,
};

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
  info: 'bg-zinc-500',
};

function layerLabel(layer: GlobeLayer): string {
  return LAYER_LABELS[layer] ?? layer;
}

function zoomForMarker(marker: GlobeMarker): number {
  if (marker.zoomTier === 'street') return 15;
  if (marker.zoomTier === 'city') return 11;
  if (marker.zoomTier === 'country') return 6;
  return 4;
}

function focusMarkers(markers: GlobeMarker[]) {
  const map = getMapInstance();
  if (!map || markers.length === 0) return;

  if (markers.length === 1) {
    const marker = markers[0]!;
    map.easeTo({
      center: [marker.lon, marker.lat],
      zoom: zoomForMarker(marker),
      duration: 650,
    });
    return;
  }

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const marker of markers) {
    west = Math.min(west, marker.lon);
    east = Math.max(east, marker.lon);
    south = Math.min(south, marker.lat);
    north = Math.max(north, marker.lat);
  }

  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: 80, duration: 700, maxZoom: 9 },
  );
}

function askAboutLayer(layer: GlobeLayer, markers: GlobeMarker[]) {
  const topEvents = markers.slice(0, 5).map((marker) => ({
    label: marker.label,
    severity: marker.severity,
    category: marker.category,
    cyberCategory: isCyberMarker(marker) ? marker.cyberCategory : undefined,
    sourceUrl: getMarkerSourceUrl(marker),
  }));

  prefillAgent(`Analyze the ${layerLabel(layer)} map layer.`, {
    sourcePanel: 'map',
    dataType: layer,
    trendData: {
      layer,
      layerLabel: layerLabel(layer),
      visibleCount: markers.length,
      topEvents,
    },
  });
}

interface MarkerRowProps {
  marker: GlobeMarker;
  isActive: boolean;
  isSelected: boolean;
  onRowEnter: (id: string, rect: DOMRect) => void;
  onRowLeave: () => void;
  onRowClick: (marker: GlobeMarker, rect: DOMRect) => void;
}

/** Presentational TOP EVENTS row. All hover/pin/timer state lives in the parent;
 *  the row only reports enter/leave/click + its rect so the parent can anchor the
 *  flyout. `data-event-id` lets the parent re-read the live rect on scroll. */
function MarkerRow({
  marker,
  isActive,
  isSelected,
  onRowEnter,
  onRowLeave,
  onRowClick,
}: MarkerRowProps) {
  const sourceUrl = getMarkerSourceUrl(marker);
  const highlighted = isSelected || isActive;

  const rectOf = (el: HTMLElement): DOMRect =>
    (el.closest('[data-event-id]') ?? el).getBoundingClientRect();

  return (
    <div
      data-event-id={marker.id}
      className={cn(
        'group flex items-start gap-2 rounded border px-2 py-1.5 transition-colors',
        highlighted
          ? 'border-amber-400/45 bg-amber-400/10'
          : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-black/25',
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onMouseEnter={(e) => onRowEnter(marker.id, rectOf(e.currentTarget))}
        onMouseLeave={onRowLeave}
        onFocus={(e) => onRowEnter(marker.id, rectOf(e.currentTarget))}
        onBlur={onRowLeave}
        onClick={(e) => onRowClick(marker, rectOf(e.currentTarget))}
      >
        <span className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_CLASSES[marker.severity])} />
          <span
            className={cn(
              'truncate text-[10px] font-semibold',
              highlighted ? 'text-amber-200' : 'text-zinc-200',
            )}
          >
            {marker.label}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[9px] text-zinc-500">
          {isCyberMarker(marker)
            ? `${marker.cyberCategory.replace('_', ' ')} / ${marker.streamSource.replace('_', ' ')}`
            : marker.source}
        </span>
      </button>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-info)]"
          aria-label={`Open source for ${marker.label}`}
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

export function LayerIntelligenceDrawer() {
  const viewMode = useMapStore((s) => s.viewMode);
  const layerDrawerOpen = useMapStore((s) => s.layerDrawerOpen);
  const activeLayerDrawer = useMapStore((s) => s.activeLayerDrawer);
  const closeLayerDrawer = useMapStore((s) => s.closeLayerDrawer);
  const activeLayers = useMapStore((s) => s.activeLayers);
  const setLayerActive = useMapStore((s) => s.setLayerActive);
  const isolatedLayer = useMapStore((s) => s.isolatedLayer);
  const setIsolatedLayer = useMapStore((s) => s.setIsolatedLayer);
  const severityFilter = useMapStore((s) => s.severityFilter);
  const setSeverityFilter = useMapStore((s) => s.setSeverityFilter);
  const markers = useMapStore((s) => s.markers);
  const selectMarker = useMapStore((s) => s.selectMarker);
  const selectHotspot = useMapStore((s) => s.selectHotspot);
  const flyTo = useMapStore((s) => s.flyTo);
  const hotspots = useMapStore((s) => s.hotspots);
  const selectedMarkerId = useMapStore((s) => s.selectedMarkerId);
  const selectMarkerGlobe = useGlobeStore((s) => s.selectMarker);

  const layer = activeLayerDrawer;
  const stats = useMemo(() => buildLayerStats(markers, activeLayers), [markers, activeLayers]);
  const layerStats = layer ? stats[layer] : null;

  // Full set for this layer, narrowed by active-sublayer visibility + severity
  // filter, sorted like the canonical top-events list. Drives Visible count, Focus,
  // Ask Max, AND the Top Events list — so all four agree (fixes the prior
  // Visible-vs-list drift) and the severity chips filter every one of them.
  const layerMarkers = useMemo(() => {
    if (!layer) return [];
    return markersForLayer(markers, layer)
      .filter((marker) => markerVisibleForActiveLayers(marker, activeLayers))
      .filter((marker) => !severityFilter || marker.severity === severityFilter)
      .sort(sortTopEvents);
  }, [layer, markers, activeLayers, severityFilter]);

  const topEventRows = useMemo(() => layerMarkers.slice(0, 8), [layerMarkers]);

  // ─── Flyout hover/pin state (drawer-local) ───
  const [hoverEventId, setHoverEventId] = useState<string | null>(null);
  const [pinnedEventId, setPinnedEventId] = useState<string | null>(null);
  const [rowRect, setRowRect] = useState<DOMRect | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number } | null>(null);
  const intentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef<string | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  // Resolve pin/hover ids THROUGH the live list so a stale id (its marker left the
  // layer or got filtered out) is simply inert — no cleanup effect needed. A pinned
  // marker wins, else the hovered one; activeEventId is always in-list or null.
  const pinnedMarker = useMemo(
    () => (pinnedEventId ? (layerMarkers.find((m) => m.id === pinnedEventId) ?? null) : null),
    [pinnedEventId, layerMarkers],
  );
  const hoverMarkerObj = useMemo(
    () => (hoverEventId ? (layerMarkers.find((m) => m.id === hoverEventId) ?? null) : null),
    [hoverEventId, layerMarkers],
  );
  const activeMarker = pinnedMarker ?? hoverMarkerObj;
  const activeEventId = activeMarker?.id ?? null;

  useEffect(() => {
    pinnedRef.current = pinnedMarker?.id ?? null;
  }, [pinnedMarker]);

  const clearTimer = useCallback(() => {
    if (intentTimer.current) {
      clearTimeout(intentTimer.current);
      intentTimer.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(() => {
    if (pinnedRef.current) return; // a pinned card ignores the dismiss timer
    clearTimer();
    intentTimer.current = setTimeout(() => setHoverEventId(null), GRACE_MS);
  }, [clearTimer]);

  // Mirror the active flyout marker into both stores' hover so the matching globe
  // marker highlights for the flyout's whole life (bridge + pin), and the
  // map-anchored card stays suppressed via hoverSource='list'. getState() reads
  // fresh actions (rule #24).
  useEffect(() => {
    useMapStore.getState().hoverMarker(activeEventId, 'list');
    useGlobeStore.getState().hoverMarker(activeEventId);
    return () => {
      useMapStore.getState().hoverMarker(null);
      useGlobeStore.getState().hoverMarker(null);
    };
  }, [activeEventId]);

  // Clear timer on unmount.
  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleRowEnter = useCallback(
    (id: string, rect: DOMRect) => {
      clearTimer();
      setHoverEventId(id);
      setRowRect(rect);
    },
    [clearTimer],
  );

  const handleRowLeave = useCallback(() => scheduleDismiss(), [scheduleDismiss]);

  const handleRowClick = useCallback(
    (marker: GlobeMarker, rect: DOMRect) => {
      clearTimer();
      selectMarker(marker.id);
      selectMarkerGlobe(marker.id);
      const hotspotId = marker.id.replace('hotspot-', '');
      selectHotspot(hotspots.find((h) => h.id === hotspotId) ?? null);
      flyTo(marker.lat, marker.lon, zoomForMarker(marker));
      setRowRect(rect);
      setHoverEventId(marker.id);
      setPinnedEventId((prev) => (prev === marker.id ? null : marker.id));
    },
    [clearTimer, selectMarker, selectMarkerGlobe, selectHotspot, hotspots, flyTo],
  );

  const handleFlyoutEnter = useCallback(() => clearTimer(), [clearTimer]);
  const handleFlyoutLeave = useCallback(() => scheduleDismiss(), [scheduleDismiss]);
  const handleFlyoutClose = useCallback(() => {
    clearTimer();
    setPinnedEventId(null);
    setHoverEventId(null);
  }, [clearTimer]);

  // Escape closes the flyout first (capture + stopPropagation so the global Escape
  // handler doesn't also clear hover state mid-pin).
  useEffect(() => {
    if (!activeEventId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      clearTimer();
      setPinnedEventId(null);
      setHoverEventId(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeEventId, clearTimer]);

  // Click-outside dismisses a pinned flyout (ignore clicks on the flyout or a row).
  useEffect(() => {
    if (!pinnedEventId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (flyoutRef.current?.contains(target)) return;
      if (target.closest?.('[data-event-id]')) return;
      setPinnedEventId(null);
      setHoverEventId(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [pinnedEventId]);

  // Anchor the flyout to the right of the drawer, vertically aligned to the row,
  // clamped into the viewport. Re-reads the live row rect so it tracks scroll.
  const computeFlyoutPos = useCallback(() => {
    if (!activeEventId) {
      setFlyoutPos(null);
      return;
    }
    const liveRow =
      typeof document !== 'undefined'
        ? (listScrollRef.current?.querySelector(
            `[data-event-id="${CSS.escape(activeEventId)}"]`,
          ) as HTMLElement | null)
        : null;
    const rect = liveRow?.getBoundingClientRect() ?? rowRect;
    if (!rect) {
      setFlyoutPos(null);
      return;
    }
    const asideRect = asideRef.current?.getBoundingClientRect();
    const left = (asideRect ? asideRect.right : rect.right) + 8;
    const cardH = flyoutRef.current?.offsetHeight ?? 220;
    const SAFE = 16;
    let top = rect.top;
    if (top + cardH > window.innerHeight - SAFE) top = window.innerHeight - SAFE - cardH;
    if (top < SAFE) top = SAFE;
    setFlyoutPos({ left, top });
  }, [activeEventId, rowRect]);

  // Position on active/rowRect change (computeFlyoutPos identity tracks both). Both
  // passes run inside rAF callbacks so setState never fires synchronously in the
  // effect body; the second pass picks up the flyout's measured height.
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      computeFlyoutPos();
      raf2 = requestAnimationFrame(computeFlyoutPos);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [computeFlyoutPos]);

  // Track drawer scroll + window resize while a flyout is open (rAF-throttled).
  useEffect(() => {
    if (!activeEventId) return;
    let raf = 0;
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(computeFlyoutPos);
    };
    const list = listScrollRef.current;
    list?.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);
    return () => {
      cancelAnimationFrame(raf);
      list?.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [activeEventId, computeFlyoutPos]);

  if (viewMode !== 'map') return null;

  const isIsolated = layer != null && isolatedLayer === layer;

  return (
    <>
      <AnimatePresence>
        {layerDrawerOpen && layer && layerStats && (
          <motion.aside
            key={layer}
            ref={asideRef}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed w-[340px] overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 shadow-2xl backdrop-blur-md"
            style={{
              left: 'calc(var(--sidebar-width) + 8px)',
              top: 'calc(var(--header-height) + var(--top-ticker-height) + 8px)',
              bottom: 'calc(var(--command-bar-height) + var(--bottom-ticker-height) + 8px)',
              zIndex: 51,
            }}
          >
            <div className="flex h-full flex-col">
              <header className="border-b border-[var(--border-subtle)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-zinc-500">
                      Layer Intelligence
                    </p>
                    <h2 className="mt-1 text-sm font-semibold text-zinc-100">
                      {layerLabel(layer)}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeLayerDrawer}
                    className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    aria-label="Close layer drawer"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded border border-[var(--border-subtle)] bg-black/20 px-2 py-1.5">
                    <span className="block text-[8px] uppercase tracking-wider text-zinc-600">
                      Located
                    </span>
                    <span className="text-sm font-semibold text-zinc-100">{layerStats.total}</span>
                  </div>
                  <div className="rounded border border-[var(--border-subtle)] bg-black/20 px-2 py-1.5">
                    <span className="block text-[8px] uppercase tracking-wider text-zinc-600">
                      Visible
                    </span>
                    <span className="text-sm font-semibold text-zinc-100">
                      {layerMarkers.length}
                    </span>
                  </div>
                  <div className="rounded border border-[var(--border-subtle)] bg-black/20 px-2 py-1.5">
                    <span className="block text-[8px] uppercase tracking-wider text-zinc-600">
                      Status
                    </span>
                    <span className="text-sm font-semibold text-[var(--color-info)]">
                      {layerStats.active ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
              </header>

              <div ref={listScrollRef} className="space-y-3 overflow-y-auto p-3">
                <div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setLayerActive(layer, !layerStats.active)}
                      title={
                        layerStats.active
                          ? 'Hide this layer on the globe'
                          : 'Show this layer on the globe'
                      }
                      className={cn(
                        'flex flex-1 items-center justify-center rounded border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider',
                        layerStats.active
                          ? 'border-[var(--color-info)]/35 bg-[var(--color-info)]/10 text-[var(--color-info)]'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-400',
                      )}
                    >
                      {layerStats.active ? 'Layer On' : 'Layer Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsolatedLayer(isIsolated ? null : layer)}
                      title={
                        isIsolated
                          ? 'Showing only this layer — click to clear'
                          : 'Hide all other layers — show only this one'
                      }
                      className={cn(
                        'flex flex-1 items-center justify-center rounded border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider',
                        isIsolated
                          ? 'border-amber-400/35 bg-amber-400/10 text-amber-300'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      {isIsolated ? 'Isolated' : 'Show Only'}
                    </button>
                  </div>
                  <p className="mt-1 text-[8px] font-mono uppercase tracking-wider text-zinc-600">
                    {isIsolated
                      ? 'Showing only this layer · tap Isolated to clear'
                      : 'Layer On toggles this layer · Show Only hides the rest'}
                  </p>
                </div>

                <div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(Object.entries(layerStats.bySeverity) as [Severity, number][]).map(
                      ([severity, count]) => {
                        const active = severityFilter === severity;
                        return (
                          <button
                            key={severity}
                            type="button"
                            onClick={() => setSeverityFilter(active ? null : severity)}
                            title={`Filter to ${severity} — click again to clear`}
                            className={cn(
                              'rounded px-1.5 py-1 transition-colors',
                              active
                                ? 'bg-[var(--color-info)]/10 ring-1 ring-[var(--color-info)]'
                                : 'bg-black/25 hover:bg-black/40',
                              severityFilter && !active ? 'opacity-40' : '',
                            )}
                          >
                            <span
                              className={cn(
                                'mb-1 block h-1 w-full rounded-full',
                                SEVERITY_CLASSES[severity],
                              )}
                            />
                            <span className="block text-center text-[9px] font-mono text-zinc-400">
                              {count}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                  {severityFilter && (
                    <p className="mt-1 text-[8px] font-mono uppercase tracking-wider text-[var(--color-info)]/80">
                      Filtered to {severityFilter} · tap again to clear
                    </p>
                  )}
                </div>

                {isCyberLayer(layer) && (
                  <div className="rounded border border-[var(--border-subtle)] bg-black/20 p-2">
                    <p className="mb-2 text-[9px] uppercase tracking-wider text-zinc-600">
                      Source mix
                    </p>
                    <div className="space-y-1">
                      {Object.entries(layerStats.byStream)
                        .filter(([, count]) => count > 0)
                        .map(([stream, count]) => (
                          <div
                            key={stream}
                            className="flex items-center justify-between text-[10px]"
                          >
                            <span className="text-zinc-500">{stream.replace('_', ' ')}</span>
                            <span className="font-mono text-zinc-300">{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={layerMarkers.length === 0}
                      onClick={() => focusMarkers(layerMarkers)}
                      title="Fly the globe to frame this layer's markers"
                      className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[var(--color-info)]/25 bg-[var(--color-info)]/10 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-info)] disabled:cursor-default disabled:border-zinc-800 disabled:bg-zinc-950 disabled:text-zinc-700"
                    >
                      <LocateFixed size={12} />
                      Focus
                    </button>
                    <button
                      type="button"
                      disabled={layerMarkers.length === 0}
                      onClick={() => askAboutLayer(layer, layerMarkers)}
                      title="Send this layer's top events to Max for analysis"
                      className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[var(--color-info)]/25 bg-[var(--color-info)]/10 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-info)] disabled:cursor-default disabled:border-zinc-800 disabled:bg-zinc-950 disabled:text-zinc-700"
                    >
                      <RadioTower size={12} />
                      Ask Max
                    </button>
                  </div>
                  <p className="mt-1 text-[8px] font-mono uppercase tracking-wider text-zinc-600">
                    Focus flies the globe here · Ask Max briefs the analyst
                  </p>
                </div>

                <section>
                  <p className="mb-1.5 text-[9px] uppercase tracking-wider text-zinc-600">
                    Top events
                  </p>
                  {topEventRows.length > 0 ? (
                    <div className="space-y-1">
                      {topEventRows.map((marker) => (
                        <MarkerRow
                          key={marker.id}
                          marker={marker}
                          isActive={activeEventId === marker.id}
                          isSelected={selectedMarkerId === marker.id}
                          onRowEnter={handleRowEnter}
                          onRowLeave={handleRowLeave}
                          onRowClick={handleRowClick}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded border border-dashed border-zinc-800 p-3 text-[10px] leading-relaxed text-zinc-500">
                      {severityFilter
                        ? `No ${severityFilter}-severity markers for this layer. Tap the severity chip again to clear the filter.`
                        : 'No located markers for this layer yet. The monitor is still listening; live DB, RSS, store, and seed feeds will populate this drawer as they resolve coordinates.'}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {activeMarker && flyoutPos && (
        <LayerEventFlyout
          marker={activeMarker}
          pinned={pinnedMarker != null}
          position={flyoutPos}
          flyoutRef={flyoutRef}
          onClose={handleFlyoutClose}
          onAnalyze={() => analyzeMarker(activeMarker)}
          onMouseEnter={handleFlyoutEnter}
          onMouseLeave={handleFlyoutLeave}
        />
      )}
    </>
  );
}

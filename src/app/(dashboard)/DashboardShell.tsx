'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Minimize2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef } from 'react';
import { AgentCommandBar } from '@/components/agent/AgentCommandBar';
import { AgentDrawer } from '@/components/agent/AgentDrawer';
import { GlobeDetailPanel } from '@/components/globe/GlobeDetailPanel';
import { HeroVisualization } from '@/components/hero/HeroVisualization';
import { ColumnExpandTab } from '@/components/layout/ColumnExpandTab';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { Header } from '@/components/layout/Header';
import { LayerIntelligenceDrawer } from '@/components/layout/LayerIntelligenceDrawer';
import { Sidebar } from '@/components/layout/Sidebar';
import { BottomTickerBand, TopTickerBand } from '@/components/layout/TickerBand';
import { MapDataProvider } from '@/components/map/MapDataProvider';
import { MapDetailPanel } from '@/components/map/MapDetailPanel';
import { PanelSlot } from '@/components/panels/PanelSlot';
import { PANEL_COMPONENTS } from '@/components/panels/panel-registry';
import { PreferencesBridge } from '@/components/providers/PreferencesBridge';
import { AgentToast } from '@/components/ui/AgentToast';
import { useActivationEvents } from '@/lib/hooks/use-activation-events';
import { useBreakingAlerts } from '@/lib/hooks/use-breaking-alerts';
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts';
import { useAlertsData, useCyberAiNewsData } from '@/lib/hooks/use-realtime-data';
import { useAgentStore } from '@/lib/store/agent-store';
import { useConnectionStore } from '@/lib/store/connection-store';
import { useLayoutStore } from '@/lib/store/layout-store';
import { useMapStore } from '@/lib/store/map-store';
import { usePanelsStore } from '@/lib/store/panels-store';
import type { BriefSummary, PanelId, SlotId } from '@/lib/types';
import { useRealtimeUpdates } from '@/lib/ws/client';

const CompanionMode = dynamic(
  () => import('@/components/companion/CompanionMode').then((mod) => mod.CompanionMode),
  { ssr: false },
);

/* ─── Media panel detection helper (livestream + YouTube) ─── */

function isMediaPanel(panelId: PanelId | undefined): boolean {
  return panelId === 'livestream' || panelId === 'livestream2' || panelId === 'youtubeSearch';
}

/* ─── QueryClient factory ─── */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchInterval: 60_000,
        retry: 2,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

/* ─── Detail Panel Switcher ─── */

function DetailPanelLayer() {
  const viewMode = useMapStore((s) => s.viewMode);

  if (viewMode !== 'globe') {
    return (
      <div className="pointer-events-auto">
        <MapDetailPanel />
      </div>
    );
  }

  return (
    <div className="pointer-events-auto">
      <GlobeDetailPanel />
    </div>
  );
}

/* ─── Fullscreen Overlay ─── */

function FullscreenOverlay() {
  const fullscreenSlot = usePanelsStore((s) => s.fullscreenSlot);
  const heroFullscreen = usePanelsStore((s) => s.heroFullscreen);
  const setFullscreenSlot = usePanelsStore((s) => s.setFullscreenSlot);
  const setHeroFullscreen = usePanelsStore((s) => s.setHeroFullscreen);
  const slotAssignments = usePanelsStore((s) => s.slotAssignments);

  // Close on Escape — layered dismissal: drawer first, then fullscreen
  useEffect(() => {
    if (!fullscreenSlot && !heroFullscreen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // If agent drawer is open, let its own handler close it first
        const drawerOpen = useAgentStore.getState().drawerOpen;
        if (drawerOpen) return;

        e.stopPropagation();
        if (fullscreenSlot) setFullscreenSlot(null);
        if (heroFullscreen) setHeroFullscreen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [fullscreenSlot, heroFullscreen, setFullscreenSlot, setHeroFullscreen]);

  if (heroFullscreen) {
    return (
      <div className="fixed inset-0 bg-[var(--bg-primary)]" style={{ zIndex: 'var(--z-dialog)' }}>
        <div className="relative h-full w-full">
          <HeroVisualization presentation="fullscreen" />
        </div>
        <button
          type="button"
          onClick={() => setHeroFullscreen(false)}
          className="fixed top-4 right-4 flex h-8 w-8 items-center justify-center bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--crt-glow)] transition-colors"
          style={{ zIndex: 'var(--z-dialog)' }}
          aria-label="Exit fullscreen"
        >
          <Minimize2 size={16} />
        </button>
      </div>
    );
  }

  if (fullscreenSlot) {
    const panelId = slotAssignments[fullscreenSlot];
    const Component = panelId ? PANEL_COMPONENTS[panelId] : undefined;

    return (
      <div
        className="fixed inset-0 bg-[var(--bg-primary)] p-4"
        style={{ zIndex: 'var(--z-dialog)' }}
      >
        <div className="h-full w-full" style={{ zoom: 1.5 }}>
          {Component ? <Component /> : null}
        </div>
        {isMediaPanel(panelId) && <CompanionMode panelId={panelId} />}
        <button
          type="button"
          onClick={() => setFullscreenSlot(null)}
          className="fixed top-4 right-4 flex h-8 w-8 items-center justify-center bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--crt-glow)] transition-colors"
          style={{ zIndex: 'var(--z-dialog)' }}
          aria-label="Exit fullscreen"
        >
          <Minimize2 size={16} />
        </button>
      </div>
    );
  }

  return null;
}

/* ─── Grid slot IDs ─── */

const GRID_SLOTS: SlotId[] = [
  'grid-1',
  'grid-2',
  'grid-3',
  'grid-4',
  'grid-5',
  'grid-6',
  'grid-7',
  'grid-8',
  'grid-9',
  'grid-10',
  'grid-11',
  'grid-12',
];

/* ─── Dashboard Shell (client) ─── */

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const heroFullscreen = usePanelsStore((s) => s.heroFullscreen);
  const setHeroFullscreen = usePanelsStore((s) => s.setHeroFullscreen);
  const leftCollapsed = usePanelsStore((s) => s.leftColumnCollapsed);
  const rightCollapsed = usePanelsStore((s) => s.rightColumnCollapsed);
  const drawerOpen = useAgentStore((s) => s.drawerOpen);
  const drawerFullscreen = useAgentStore((s) => s.drawerFullscreen);
  const setHeroScrolledAway = useLayoutStore((s) => s.setHeroScrolledAway);
  const setScrollToHero = useLayoutStore((s) => s.setScrollToHero);
  const setScrollContainer = useLayoutStore((s) => s.setScrollContainer);

  // Refs
  const mainRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLElement>(null);

  // WebSocket realtime updates run inside <WebSocketBridge /> below — it must
  // mount as a child of <QueryClientProvider> so useQueryClient() (added in
  // Phase 9.1 for the approval-queue WS event dispatch) can find the client.
  // Calling useRealtimeUpdates() here at DashboardShell's top level would
  // execute the hook BEFORE the provider mounts in the JSX, throwing
  // "No QueryClient set" at runtime.

  // Activate cross-store bridge for breaking alerts
  useBreakingAlerts();

  // Mount global keyboard shortcuts (Cmd+K, Cmd+B, Cmd+[, Cmd+], etc.)
  useKeyboardShortcuts();

  // Wire data store changes to agent activation events
  useActivationEvents();

  // Hydrate persisted briefs from DB on startup — merges with localStorage briefs
  useEffect(() => {
    fetch('/api/agent/briefs')
      .then((r) => (r.ok ? r.json() : []))
      .then((dbBriefs: BriefSummary[]) => {
        if (!dbBriefs.length) return;
        const { recentBriefs, setRecentBriefs } = useAgentStore.getState();
        const existingIds = new Set(recentBriefs.map((b) => b.id));
        // Merge: keep localStorage briefs, append DB briefs not already present
        const merged = [...recentBriefs, ...dbBriefs.filter((b) => !existingIds.has(b.id))]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 20);
        setRecentBriefs(merged);
      })
      .catch(() => {
        /* DB unavailable — localStorage briefs still work */
      });
  }, []);

  // Trigger map/globe resize after instant snap — single event suffices
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect must fire when collapsed/drawer state changes to resize canvases
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [leftCollapsed, rightCollapsed, drawerOpen, drawerFullscreen]);

  // Double-click handler for hero fullscreen
  const handleHeroDoubleClick = useCallback(() => {
    setHeroFullscreen(true);
  }, [setHeroFullscreen]);

  // Scroll-to-top handler — register in layout store
  useEffect(() => {
    const scrollToTop = () => {
      mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    };
    setScrollToHero(scrollToTop);
    return () => setScrollToHero(null);
  }, [setScrollToHero]);

  // Expose <main> scroll container to layout-store for sidebar scroll arrows
  useEffect(() => {
    setScrollContainer(mainRef.current);
    return () => setScrollContainer(null);
  }, [setScrollContainer]);

  // IntersectionObserver: detect when hero scrolls out of view
  useEffect(() => {
    const hero = heroRef.current;
    const main = mainRef.current;
    if (!hero || !main) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeroScrolledAway(!entry!.isIntersecting),
      { root: main, threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [setHeroScrolledAway]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* WebSocket subscription + connection-store sync (Phase 9.1 bug fix):
          must live inside QueryClientProvider because useRealtimeUpdates calls
          useQueryClient() to invalidate the approval-queue cache on
          outbound:draft_added / outbound:draft_decided events. */}
      <WebSocketBridge />

      {/* Load data into both globe and map stores */}
      <MapDataProvider />

      {/* Feed cyber + AI news into the store for the autonomous news alert
          (must be under QueryClientProvider — see CyberAiNewsBridge). */}
      <CyberAiNewsBridge />

      {/* Hydrate the alerts-store from the AEGIS alert spine. */}
      <AlertsBridge />

      {/* Hydrate DB-per-user preferences into the prefs-store (Phase 2). */}
      <PreferencesBridge />

      {/* Sidebar */}
      <Sidebar />
      <LayerIntelligenceDrawer />

      {/* Header */}
      <Header />

      {/* Top ticker stack */}
      <TopTickerBand />

      {/* Command palette (Cmd+K) */}
      <CommandPalette />

      {/* Main area: scroll-away hero + scrollable grid */}
      <main
        ref={mainRef}
        className="fixed overflow-y-auto"
        style={{
          top: 'calc(var(--header-height) + var(--top-ticker-height))',
          left: 'var(--sidebar-width)',
          right: drawerOpen && !drawerFullscreen ? 'var(--agent-drawer-width)' : 0,
          bottom: 'calc(var(--command-bar-height) + var(--bottom-ticker-height))',
        }}
      >
        {/* ── Hero section (scrolls away naturally, NOT sticky) ── */}
        <section
          ref={heroRef}
          className="hero-section"
          style={{
            height:
              'calc(100vh - var(--header-height) - var(--top-ticker-height) - var(--command-bar-height) - var(--bottom-ticker-height))',
            display: 'grid',
            gridTemplateColumns: `${leftCollapsed ? '0px' : 'var(--u-side-width)'} 1fr ${rightCollapsed ? '0px' : 'var(--u-side-width)'}`,
            gridTemplateRows: '1fr var(--u-bottom-height)',
            gridTemplateAreas: `
              "left   hero   right"
              "bottom bottom bottom"
            `,
            gap: 'var(--u-gap)',
            padding: 'var(--u-gap)',
          }}
        >
          {/* Left column — single full-height panel slot */}
          <div
            className="flex flex-col gap-[var(--u-gap)] min-h-0"
            style={{
              gridArea: 'left',
              overflow: 'hidden',
              minWidth: 0,
              opacity: leftCollapsed ? 0 : 1,
              pointerEvents: leftCollapsed ? 'none' : 'auto',
            }}
          >
            <PanelSlot slotId="left-1" className="flex-1" />
          </div>

          {/* Center — map in its OWN cell, fully interactive */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: hero double-click for fullscreen */}
          <div
            className="relative overflow-hidden min-h-0"
            style={{
              gridArea: 'hero',
            }}
            onDoubleClick={handleHeroDoubleClick}
          >
            {/* Map/Globe/Command + CVE timeline + Threat graph tabs (with switcher) —
                skip when fullscreen to avoid duplicate hover cards */}
            {!heroFullscreen && <HeroVisualization />}

            {/* Detail panel */}
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 15 }}>
              <DetailPanelLayer />
            </div>

            {/* Floating expand tabs when columns are collapsed */}
            <ColumnExpandTab side="left" />
            <ColumnExpandTab side="right" />
          </div>

          {/* Right column — two stacked panel slots */}
          <div
            className="flex flex-col gap-[var(--u-gap)] min-h-0"
            style={{
              gridArea: 'right',
              overflow: 'hidden',
              minWidth: 0,
              opacity: rightCollapsed ? 0 : 1,
              pointerEvents: rightCollapsed ? 'none' : 'auto',
            }}
          >
            <PanelSlot slotId="right-1" className="flex-1" />
            <PanelSlot slotId="right-2" className="flex-1" />
          </div>

          {/* Bottom row — 2 panel slots */}
          <div className="flex gap-[var(--u-gap)] min-h-0" style={{ gridArea: 'bottom' }}>
            <PanelSlot slotId="bottom-1" className="flex-1" />
            <PanelSlot slotId="bottom-2" className="flex-1" />
          </div>
        </section>

        {/* ── Grid section — 12 scrollable panels ── */}
        <div
          className="grid-section"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(var(--grid-columns), 1fr)`,
            gap: 'var(--u-gap)',
            padding: 'var(--u-gap)',
            paddingBottom: 'var(--u-gap)',
            overflow: 'hidden',
          }}
        >
          {GRID_SLOTS.map((slotId) => (
            <PanelSlot key={slotId} slotId={slotId} className="h-[var(--grid-panel-height)]" />
          ))}
        </div>

        {/* Responsive styles */}
        <style>{`
          @media (max-width: 1439px) {
            .hero-section {
              --u-side-width: 280px;
            }
          }
          @media (max-width: 1279px) {
            :root {
              --grid-columns: 2;
            }
          }
          @media (max-width: 1199px) {
            .hero-section {
              grid-template-columns: 1fr !important;
              grid-template-rows: 300px auto auto !important;
              grid-template-areas:
                "hero"
                "left"
                "right"
                "bottom" !important;
              height: auto !important;
              transition: none !important;
            }
            .hero-section > div[style*="grid-area: left"],
            .hero-section > div[style*="grid-area: right"] {
              flex-direction: row !important;
              opacity: 1 !important;
              pointer-events: auto !important;
              overflow: visible !important;
            }
            .column-expand-tab { display: none !important; }
            .collapse-column-btn { display: none !important; }
            :root {
              --grid-columns: 1;
            }
          }
        `}</style>
      </main>

      {/* Portal target for map popups/tooltips — z-52 (above fullscreen overlay) */}
      <div
        id="map-popup-portal"
        className="fixed inset-0 pointer-events-none overflow-hidden"
        style={{ zIndex: 52 }}
      />

      {/* Fullscreen overlay */}
      <FullscreenOverlay />

      {/* Agent command bar - elevated z-index, always visible */}
      <AgentCommandBar />

      {/* Bottom ticker stack */}
      <BottomTickerBand />

      {/* Agent conversation drawer */}
      <AgentDrawer />

      {/* Autonomous agent toast notifications */}
      <AgentToast />

      {/* Page slot (minimal in command center mode) */}
      {children}
    </QueryClientProvider>
  );
}

/**
 * WebSocketBridge — Phase 9.1 bug fix.
 *
 * Subscribes to the realtime WS feed and syncs the connection-store flag.
 * MUST render as a child of QueryClientProvider because useRealtimeUpdates
 * internally calls useQueryClient() to invalidate the approval-queue cache
 * on outbound:draft_added / outbound:draft_decided events. Calling this
 * hook at DashboardShell's top level would execute it BEFORE the JSX
 * returns the QueryClientProvider, throwing "No QueryClient set" at
 * runtime (root cause documented in this file's git history).
 *
 * Returns null — the hook's only outputs are side effects: Zustand store
 * updates + TanStack cache invalidations.
 */
function WebSocketBridge(): null {
  const { connected } = useRealtimeUpdates();
  const setWsConnected = useConnectionStore((s) => s.setWsConnected);
  useEffect(() => {
    setWsConnected(connected);
  }, [connected, setWsConnected]);
  return null;
}

/**
 * CyberAiNewsBridge — feeds the cyber + AI news categories into the data store
 * for the autonomous AI+cyber news alert. MUST render as a child of
 * QueryClientProvider because useCyberAiNewsData calls useQuery; the alert's
 * watcher in useActivationEvents (at DashboardShell's top level, outside the
 * provider) only READS the resulting news['cyber'] / news['ai'] store slices.
 * Returns null — its only output is the store-population side effect.
 */
function CyberAiNewsBridge(): null {
  useCyberAiNewsData();
  return null;
}

/**
 * AlertsBridge — hydrates the alerts-store from the AEGIS alert spine
 * (`aegis_pipeline_alerts` via /api/data/alerts). Mounted globally rather than
 * inside AlertsPanel because four surfaces read this store: the ALERTS panel,
 * the top threat ticker, the "since your last visit" delta, and the hero
 * breaking-alert overlay. Gating hydration on one panel's visibility would
 * silently starve the other three.
 *
 * Must be a child of QueryClientProvider — it calls useQuery.
 */
function AlertsBridge(): null {
  useAlertsData({ limit: 50 });
  return null;
}

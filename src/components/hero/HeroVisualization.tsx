'use client';

import { Aperture } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ZoomControls } from '@/components/layout/ZoomControls';
import { MapBaseStyleSwitcher } from '@/components/map/MapBaseStyleSwitcher';
import { MapBreakingOverlay } from '@/components/map/MapBreakingOverlay';
import { useWarRoomArcs } from '@/lib/hooks/use-warroom-arcs';
import { type HeroTab, useMapStore } from '@/lib/store/map-store';
import { GeoTab } from './GeoTab';

/* ─── Lazy-loaded analytical tabs (CVE + 4 graph lenses stay out of the GEO critical path) ─── */

const CVETimelineTab = dynamic(() => import('./CVETimelineTab').then((mod) => mod.CVETimelineTab), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder label="Loading CVE timeline" />,
});

const TreeLensTab = dynamic(() => import('./TreeLensTab').then((mod) => mod.TreeLensTab), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder label="Loading threat tree" />,
});

const RingsLensTab = dynamic(() => import('./RingsLensTab').then((mod) => mod.RingsLensTab), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder label="Loading threat rings" />,
});

const MatrixLensTab = dynamic(() => import('./MatrixLensTab').then((mod) => mod.MatrixLensTab), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder label="Loading MITRE matrix" />,
});

const SankeyLensTab = dynamic(() => import('./SankeyLensTab').then((mod) => mod.SankeyLensTab), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder label="Loading attack flow" />,
});

const HeroLiveTab = dynamic(() => import('./HeroLiveTab').then((mod) => mod.HeroLiveTab), {
  ssr: false,
  loading: () => <TabLoadingPlaceholder label="Loading live monitor" />,
});

const HeroForecastTab = dynamic(
  () => import('./HeroForecastTab').then((mod) => mod.HeroForecastTab),
  {
    ssr: false,
    loading: () => <TabLoadingPlaceholder label="Loading forecast board" />,
  },
);

function TabLoadingPlaceholder({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-wider"
      style={{ color: 'var(--text-muted, #888)' }}
    >
      {label}
    </div>
  );
}

/* ─── Map Overlays ─── */
// Quiet by default. Two pieces survive the cleanup:
//   - MapBreakingOverlay  : the *one* thing that should be loud (red flash banner
//                           when a critical event lands). Always rendered.
//   - ZoomControls        : low-key bottom-left affordance — required for the
//                           R3F globe view (no native wheel zoom there).
//
// Cut in this pass:
//   - MapCategoryFilter   : 8 geopolitical pills (CONFLICT/ECON/TECH/POLICY/…)
//                           that don't apply to a cyber/AI-focused dashboard.
//                           Category filtering now lives entirely in the sidebar.
//   - Eye/EyeOff hide btn : existed solely to hide MapCategoryFilter. Orphaned
//                           once that filter went away.
//
// The MapOverlays component is mounted inside the GEO tab wrapper so it
// hides automatically on any other lens.

function MapOverlays() {
  // The base-style switcher only makes sense over the Mapbox renderer — the R3F
  // globe and command views have no base style. ZoomControls + breaking overlay
  // apply to every view.
  const viewMode = useMapStore((s) => s.viewMode);
  return (
    <>
      <MapBreakingOverlay />
      {viewMode === 'map' && <MapBaseStyleSwitcher />}
      <ZoomControls />
    </>
  );
}

/* ─── Hero lens dock: collapsed until the operator asks for it ─── */

interface TabDef {
  id: HeroTab;
  label: string;
  ariaLabel: string;
}

type HeroPresentation = 'embedded' | 'fullscreen';

class GeoTabErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean; message: string | null }
> {
  state = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Geo visualization unavailable',
    };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      '[HeroVisualization] Geo tab recovered:',
      message,
      error instanceof Error ? error.stack : null,
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-primary)] text-center font-mono uppercase tracking-wider"
          style={{ color: 'var(--text-muted, #888)' }}
        >
          <span className="text-[10px]" style={{ color: 'var(--crt-glow, #00ff41)' }}>
            GEO UNAVAILABLE
          </span>
          <span className="max-w-sm text-[9px] leading-relaxed">{this.state.message}</span>
          <button
            type="button"
            className="mt-2 rounded border border-[rgba(var(--crt-glow-rgb),0.25)] px-2 py-1 text-[8px] font-mono uppercase tracking-wider text-[var(--crt-glow)]"
            onClick={() => this.setState({ hasError: false, message: null })}
          >
            Retry GEO
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const HERO_LENSES: ReadonlyArray<TabDef> = [
  { id: 'geo', label: 'GEO', ariaLabel: 'Geo visualization tab' },
  { id: 'warroom', label: 'WAR ROOM', ariaLabel: 'War room — live attack map' },
  { id: 'timeline', label: 'CVE', ariaLabel: 'CVE timeline tab' },
  { id: 'graph', label: 'GRAPH', ariaLabel: 'Threat network — hierarchical tree' },
  { id: 'rings', label: 'RINGS', ariaLabel: 'Threat network — concentric rings' },
  { id: 'matrix', label: 'MATRIX', ariaLabel: 'Threat network — MITRE ATT&CK matrix' },
  { id: 'sankey', label: 'SANKEY', ariaLabel: 'Threat network — attack-flow sankey' },
  { id: 'live', label: 'LIVE', ariaLabel: 'Live monitor lens' },
  { id: 'forecast', label: 'FORECAST', ariaLabel: 'AEGIS forecast lens' },
];

function HeroLensDock({ presentation }: { presentation: HeroPresentation }) {
  const heroTab = useMapStore((s) => s.heroTab);
  const setHeroTab = useMapStore((s) => s.setHeroTab);
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  const activeLens = HERO_LENSES.find((tab) => tab.id === heroTab) ?? {
    id: 'geo',
    label: 'GEO',
    ariaLabel: 'Geo visualization tab',
  };

  const selectLens = useCallback(
    (tab: HeroTab) => {
      setHeroTab(tab);
      setOpen(false);
    },
    [setHeroTab],
  );

  return (
    <div
      ref={dockRef}
      role="toolbar"
      aria-label="Hero lens dock"
      className="absolute font-mono uppercase tracking-wider"
      style={{
        top: presentation === 'fullscreen' ? '50%' : 'auto',
        bottom: presentation === 'fullscreen' ? 'auto' : 30,
        right: presentation === 'fullscreen' ? 64 : 8,
        transform: presentation === 'fullscreen' ? 'translateY(-50%)' : 'none',
        zIndex: 20,
      }}
      onBlurCapture={(event) => {
        if (!dockRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="hero-lens-dock-grid"
        aria-label={`Open hero lens menu. Current lens: ${activeLens.label}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        title={`Hero lens: ${activeLens.label}`}
        className="flex h-9 w-9 items-center justify-center rounded-[2px] border"
        style={{
          color: 'var(--crt-glow, #00ff41)',
          background: 'rgba(5, 5, 5, 0.82)',
          borderColor: 'rgba(var(--crt-glow-rgb, 0, 255, 65), 0.28)',
          backdropFilter: 'blur(8px)',
          boxShadow: open ? '0 0 18px rgba(var(--crt-glow-rgb, 0, 255, 65), 0.12)' : 'none',
          letterSpacing: '0.08em',
        }}
      >
        <Aperture size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open && (
        <div
          id="hero-lens-dock-grid"
          className="absolute top-1/2 grid -translate-y-1/2 grid-cols-2 gap-1 p-1 sm:grid-cols-4"
          style={{
            right: 46,
            width: 'min(360px, calc(100vw - 112px))',
            background: 'rgba(5, 5, 5, 0.9)',
            border: '1px solid rgba(var(--crt-glow-rgb, 0, 255, 65), 0.22)',
            backdropFilter: 'blur(10px)',
          }}
        >
          {HERO_LENSES.map((tab) => {
            const active = tab.id === heroTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectLens(tab.id)}
                aria-label={tab.ariaLabel}
                aria-pressed={active}
                className="h-7 min-w-0 rounded-[2px] px-2 text-[9px] font-semibold"
                style={{
                  color: active ? 'var(--crt-glow, #00ff41)' : 'var(--text-muted, #888)',
                  background: active
                    ? 'rgba(var(--crt-glow-rgb, 0, 255, 65), 0.12)'
                    : 'rgba(255, 255, 255, 0.02)',
                  border: active
                    ? '1px solid rgba(var(--crt-glow-rgb, 0, 255, 65), 0.55)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  letterSpacing: '0.08em',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── War-room controller ─── */
// War room reuses the single GEO canvas (no duplicate Mapbox/R3F instance): it
// drives cyber attack arcs into both arc stores + forces the arcs layer on while
// active, and overlays a HUD label. Hook runs unconditionally; it no-ops when
// inactive (query disabled).

function WarRoomController({ active }: { active: boolean }) {
  const arcCount = useWarRoomArcs(active);
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-[2px] border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
      style={{
        zIndex: 18,
        color: 'var(--crt-glow, #00ff41)',
        background: 'rgba(5, 5, 5, 0.8)',
        borderColor: 'rgba(var(--crt-glow-rgb, 0, 255, 65), 0.3)',
        backdropFilter: 'blur(6px)',
      }}
    >
      War Room · {arcCount} live attack {arcCount === 1 ? 'vector' : 'vectors'}
    </div>
  );
}

/* ─── HeroVisualization — 9-lens orchestrator (GEO doubles as WAR ROOM) ─── */

/**
 * HeroVisualization
 *
 * Renders 8 hero lenses as siblings positioned absolutely. Only the active tab
 * is `display: block`; the others stay mounted at `display: none` so Mapbox,
 * Canvas contexts, and lens state are preserved across tab switches.
 *
 *   - GEO     : Map / globe / command stack (existing)
 *   - CVE     : D3 CVE swim-lane timeline (existing)
 *   - GRAPH   : Threat network — hierarchical tree (Phase 8.10, default)
 *   - RINGS   : Threat network — concentric rings (Phase 8.10)
 *   - MATRIX  : Threat network — MITRE ATT&CK heatmap (Phase 8.10)
 *   - SANKEY  : Threat network — attack-flow sankey (Phase 8.10)
 *   - LIVE    : Shell-free livestream monitor
 *   - FORECAST: AEGIS prediction board
 *
 * The MapOverlays HUD is nested INSIDE the GEO tab wrapper so it correctly
 * hides when any other lens is active.
 *
 * On tab switch, dispatch a window resize so Mapbox/Canvas redraw at the
 * correct dimensions when transitioning from display:none → block.
 */
export function HeroVisualization({
  presentation = 'embedded',
}: {
  presentation?: HeroPresentation;
}) {
  const heroTab = useMapStore((s) => s.heroTab);
  const viewMode = useMapStore((s) => s.viewMode);

  // biome-ignore lint/correctness/useExhaustiveDependencies: effect must re-run on heroTab change to trigger Mapbox/Sigma resize after display:block flip
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 0);
    return () => window.clearTimeout(id);
  }, [heroTab]);

  return (
    <>
      {/* GEO + WAR ROOM share the one Map/Globe/Command canvas (no duplicate
          Mapbox/R3F). War room = the same globe with cyber attack arcs forced on
          + a HUD label, driven by WarRoomController. */}
      <div
        className="absolute inset-0"
        style={{ display: heroTab === 'geo' || heroTab === 'warroom' ? 'block' : 'none' }}
      >
        <div className="absolute inset-0">
          <GeoTabErrorBoundary resetKey={viewMode}>
            <GeoTab />
          </GeoTabErrorBoundary>
        </div>
        <MapOverlays />
        <WarRoomController active={heroTab === 'warroom'} />
      </div>

      {/* CVE Timeline tab */}
      <div
        className="absolute inset-0"
        style={{ display: heroTab === 'timeline' ? 'block' : 'none' }}
      >
        <CVETimelineTab presentation={presentation} />
      </div>

      {/* GRAPH tab — hierarchical tree (Phase 8.10 default lens) */}
      <div className="absolute inset-0" style={{ display: heroTab === 'graph' ? 'block' : 'none' }}>
        <TreeLensTab />
      </div>

      {/* RINGS tab — concentric apex-actor radar */}
      <div className="absolute inset-0" style={{ display: heroTab === 'rings' ? 'block' : 'none' }}>
        <RingsLensTab />
      </div>

      {/* MATRIX tab — MITRE ATT&CK actors × tactics heatmap */}
      <div
        className="absolute inset-0"
        style={{ display: heroTab === 'matrix' ? 'block' : 'none' }}
      >
        <MatrixLensTab />
      </div>

      {/* SANKEY tab — attack-flow diagram */}
      <div
        className="absolute inset-0"
        style={{ display: heroTab === 'sankey' ? 'block' : 'none' }}
      >
        <SankeyLensTab />
      </div>

      {/* LIVE tab — shell-free livestream surface; playback stops while hidden */}
      <div className="absolute inset-0" style={{ display: heroTab === 'live' ? 'block' : 'none' }}>
        <HeroLiveTab active={heroTab === 'live'} />
      </div>

      {/* FORECAST tab — shell-free AEGIS prediction surface */}
      <div
        className="absolute inset-0"
        style={{ display: heroTab === 'forecast' ? 'block' : 'none' }}
      >
        <HeroForecastTab />
      </div>

      {/* Lens dock — collapsed by default so it doesn't sit on top of labels */}
      <HeroLensDock presentation={presentation} />
    </>
  );
}

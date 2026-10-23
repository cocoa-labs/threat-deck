'use client';

import {
  Activity,
  BellOff,
  BellRing,
  Brain,
  Bug,
  Cable,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Globe,
  Layers,
  Map as MapIcon,
  Monitor,
  MoreHorizontal,
  Radio,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CocoaSigil } from '@/components/brand/CocoaSigil';
import {
  ACCENT_PALETTE_ORDER,
  ACCENT_THEMES,
  type AccentPalette,
  useAccentStore,
} from '@/lib/store/accent-store';
import { useAgentStore } from '@/lib/store/agent-store';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useLayoutStore } from '@/lib/store/layout-store';
import { useMapStore } from '@/lib/store/map-store';
import type { GlobeLayer, ViewMode } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { buildLayerStats } from '@/lib/utils/cyber-markers';
import { AutoRotateToggle } from './AutoRotateToggle';
import { SettingsDialog } from './SettingsDialog';

/* ─── Layer config ─── */

interface LayerToggle {
  layer: GlobeLayer;
  icon: React.ReactNode;
  label: string;
}

// Primary toggles — always visible. Cover the high-frequency global-context
// layers (markers/threatRings/dayNight default-on; heatmap/arcs default-off
// but commonly toggled).
const LAYER_TOGGLES_PRIMARY: LayerToggle[] = [
  { layer: 'markers', icon: <Globe size={18} />, label: 'Markers' },
  { layer: 'threatRings', icon: <Radio size={18} />, label: 'Threat Rings' },
  { layer: 'heatmap', icon: <Layers size={18} />, label: 'Heatmap' },
  { layer: 'arcs', icon: <Activity size={18} />, label: 'Arcs' },
  { layer: 'dayNight', icon: <Sun size={18} />, label: 'Day / Night' },
];

// Secondary toggles — collapsed behind the LAYERS `⋯` expander. These are
// geopolitical layers (low-frequency in a cyber-focused dashboard) kept
// reachable but not visually competing with primary toggles. The dropped
// `atlasMarkets` entry was an orphan from the kramer-monitor fork.
const LAYER_TOGGLES_SECONDARY: LayerToggle[] = [
  { layer: 'conflictZones', icon: <MapIcon size={18} />, label: 'Conflict Zones' },
  { layer: 'militaryBases', icon: <Shield size={18} />, label: 'Military' },
  { layer: 'infrastructure', icon: <Cable size={18} />, label: 'Infrastructure' },
];

// Primary cyber toggles — the three default-on streams that drive the globe's
// baseline cyber picture.
const CYBER_LAYER_TOGGLES_PRIMARY: LayerToggle[] = [
  { layer: 'cyberCVEs', icon: <Bug size={18} />, label: 'CVEs' },
  { layer: 'cyberBreaches', icon: <ShieldAlert size={18} />, label: 'Breaches' },
  { layer: 'cyberThreatActors', icon: <Users size={18} />, label: 'Threat Actors' },
];

// Secondary cyber toggles — collapsed behind the CYBER `⋯` expander. All
// default-off; users opt in when they need the deeper signal layers.
const CYBER_LAYER_TOGGLES_SECONDARY: LayerToggle[] = [
  { layer: 'cyberAIIncidents', icon: <Brain size={18} />, label: 'AI Incidents' },
  { layer: 'cyberCriticalInfra', icon: <Server size={18} />, label: 'Critical Infra' },
  { layer: 'cyberIOCs', icon: <Crosshair size={18} />, label: 'IOCs' },
  { layer: 'cyberAISafety', icon: <ShieldCheck size={18} />, label: 'AI Safety' },
];

/* ─── Sidebar button ─── */

function LayerButton({
  active,
  label,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  count,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  const title = count == null ? label : `${label} (${count})`;
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'group relative flex h-8 w-8 items-center justify-center rounded-md transition-all duration-150',
        active
          ? 'bg-[var(--color-info)]/15 text-[var(--color-info)]'
          : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
      )}
    >
      {/* Active accent bar */}
      {active && (
        <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--color-info)]" />
      )}
      {children}
      {count != null && count > 0 && (
        <span className="absolute -right-1 -top-1 flex min-w-3.5 items-center justify-center rounded bg-[var(--color-info)] px-1 text-[8px] font-mono font-bold leading-3 text-black">
          {count > 99 ? '99+' : count}
        </span>
      )}
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-mono text-[var(--text-secondary)] opacity-0 shadow-md transition-opacity group-hover:opacity-100">
        {title}
      </span>
    </button>
  );
}

/* ─── More toggle ─── */
// Smaller, quieter affordance than LayerButton — signals "there's more here"
// without competing with the primary layer toggles for visual weight. The
// horizontal `⋯` rotates to vertical `⋮` on expand, giving a tactile state cue.

function MoreToggle({
  expanded,
  onClick,
  label,
}: {
  expanded: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={expanded ? `Show fewer ${label}` : `Show more ${label}`}
      aria-label={expanded ? `Show fewer ${label}` : `Show more ${label}`}
      aria-expanded={expanded}
      className={cn(
        'group relative flex h-5 w-8 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--color-info)]',
      )}
    >
      <MoreHorizontal
        size={14}
        style={{
          opacity: expanded ? 0.95 : 0.55,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          // Single state flip — feels like a switch, not a slide
        }}
      />
    </button>
  );
}

/* ─── Scroll control ─── */

function AccentPaletteControl() {
  const accentPalette = useAccentStore((s) => s.accentPalette);
  const setAccentPalette = useAccentStore((s) => s.setAccentPalette);
  const [expanded, setExpanded] = useState(false);

  // Collapsed shows only the active swatch — but it's a button: clicking it (or
  // the ⋯) OPENS the full palette rather than re-selecting the current color
  // (that no-op was the "stuck on green" bug). Picking a color applies it and
  // collapses back, keeping the rail compact while staying an obvious picker.
  const palettes = expanded ? ACCENT_PALETTE_ORDER : [accentPalette];

  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      <span className="mb-1 text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
        Accent
      </span>
      <div className="flex flex-col items-center gap-1">
        {palettes.map((palette) => (
          <AccentSwatch
            key={palette}
            active={accentPalette === palette}
            palette={palette}
            onClick={() => {
              if (expanded) {
                setAccentPalette(palette);
                setExpanded(false);
              } else {
                setExpanded(true);
              }
            }}
          />
        ))}
        <MoreToggle
          expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          label="accent colors"
        />
      </div>
    </div>
  );
}

function AccentSwatch({
  active,
  palette,
  onClick,
}: {
  active: boolean;
  palette: AccentPalette;
  onClick: () => void;
}) {
  const theme = ACCENT_THEMES[palette];
  const isBlack = palette === 'black';
  const isGray = palette === 'gray';
  const swatchBorder = isBlack
    ? '1px solid rgba(244, 244, 245, 0.85)'
    : isGray
      ? '1px solid rgba(0, 0, 0, 0.75)'
      : '1px solid #000';
  const swatchShadow = isBlack
    ? active
      ? '0 0 0 2px rgba(244, 244, 245, 0.5)'
      : '0 0 0 1px rgba(255, 255, 255, 0.14)'
    : `0 0 8px rgba(${theme.readableRgb}, ${active ? 0.65 : 0.28})`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${theme.label} accent`}
      aria-label={`${theme.label} accent`}
      aria-pressed={active}
      className={cn(
        'group relative flex h-6 w-8 items-center justify-center rounded-md transition-all duration-150',
        active
          ? 'bg-[var(--color-info)]/15'
          : 'hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]',
      )}
    >
      {active && (
        <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--color-info)]" />
      )}
      <span
        className="h-3.5 w-3.5 rounded-full"
        style={{
          background: theme.accent,
          border: swatchBorder,
          boxShadow: swatchShadow,
        }}
      />
      <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-mono text-[var(--text-secondary)] opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {theme.label}
      </span>
    </button>
  );
}

function SidebarScrollControl() {
  const scrollContainer = useLayoutStore((s) => s.scrollContainer);
  const rafRef = useRef<number>(0);

  const startScrolling = useCallback(
    (direction: 1 | -1) => {
      if (!scrollContainer) return;
      const step = () => {
        scrollContainer.scrollBy({ top: direction * 8 });
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [scrollContainer],
  );

  const stopScrolling = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      <span className="mb-1 text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
        Scroll
      </span>
      <LayerButton
        active={false}
        label="Scroll Up"
        onClick={() => {}}
        onPointerDown={() => startScrolling(-1)}
        onPointerUp={stopScrolling}
        onPointerLeave={stopScrolling}
      >
        <ChevronUp size={18} />
      </LayerButton>
      <LayerButton
        active={false}
        label="Scroll Down"
        onClick={() => {}}
        onPointerDown={() => startScrolling(1)}
        onPointerUp={stopScrolling}
        onPointerLeave={stopScrolling}
      >
        <ChevronDown size={18} />
      </LayerButton>
    </div>
  );
}

/* ─── Sidebar ─── */

export function Sidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLayersExtra, setShowLayersExtra] = useState(false);
  const [showCyberExtra, setShowCyberExtra] = useState(false);
  const globeActiveLayers = useGlobeStore((s) => s.activeLayers);
  const globeToggleLayer = useGlobeStore((s) => s.toggleLayer);
  const mapActiveLayers = useMapStore((s) => s.activeLayers);
  const mapToggleLayer = useMapStore((s) => s.toggleLayer);
  const mapMarkers = useMapStore((s) => s.markers);
  const openLayerDrawer = useMapStore((s) => s.openLayerDrawer);
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);

  // Use the active store based on view mode
  const activeLayers = viewMode === 'globe' ? globeActiveLayers : mapActiveLayers;
  const layerStats = useMemo(
    () => buildLayerStats(mapMarkers, activeLayers),
    [mapMarkers, activeLayers],
  );

  // If a secondary toggle is active (user opted into a layer behind `⋯`),
  // auto-expand the section so the active state is always visible.
  const hasActiveSecondaryLayer = LAYER_TOGGLES_SECONDARY.some((lt) => activeLayers.has(lt.layer));
  const hasActiveSecondaryCyber = CYBER_LAYER_TOGGLES_SECONDARY.some((lt) =>
    activeLayers.has(lt.layer),
  );
  const layersExtraVisible = showLayersExtra || hasActiveSecondaryLayer;
  const cyberExtraVisible = showCyberExtra || hasActiveSecondaryCyber;

  const handleToggleLayer = useCallback(
    (layer: GlobeLayer) => {
      if (viewMode === 'globe') {
        globeToggleLayer(layer);
      } else {
        mapToggleLayer(layer);
        if (viewMode === 'map') {
          openLayerDrawer(layer);
        }
      }
    },
    [viewMode, globeToggleLayer, mapToggleLayer, openLayerDrawer],
  );

  const handleToggleViewMode = useCallback(() => {
    const cycle: Record<ViewMode, ViewMode> = {
      globe: 'map',
      map: 'command',
      command: 'globe',
    };
    setViewMode(cycle[viewMode]);
  }, [viewMode, setViewMode]);

  const autonomousAlertsEnabled = useAgentStore((s) => s.autonomousAlertsEnabled);
  const toggleAutonomousAlerts = useAgentStore((s) => s.toggleAutonomousAlerts);

  return (
    <aside
      className="fixed left-0 top-0 flex flex-col items-center border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] py-3"
      style={{
        width: 'var(--sidebar-width)',
        // End the rail above the bottom command-bar + ticker chrome (110px) — the
        // same reserve every other fixed surface uses (<main>, drawers, toasts) —
        // so the bottom controls (Alerts, Scroll, Settings) never hide under it.
        // Overflow is intentionally left visible so the buttons' right-edge
        // tooltips/badges aren't clipped (overflow-y:auto would force overflow-x
        // to clip them). The Accent-palette collapse keeps the collapsed rail
        // within this height; expanding both layer groups on a very short
        // viewport is the one case that can still spill (collapse one to recover).
        bottom: 'calc(var(--command-bar-height) + var(--bottom-ticker-height))',
        zIndex: 'var(--z-sidebar)',
      }}
    >
      {/* Brand mark */}
      <div
        className="flex h-8 w-8 items-center justify-center rounded-md select-none"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--brand-accent, #00ff41) 12%, transparent)',
        }}
        title="Cocoa AI Threat Deck"
      >
        <CocoaSigil size={18} />
      </div>

      {/* View mode toggle */}
      <div className="mt-4 flex flex-col items-center gap-1">
        <span className="mb-1 text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          View
        </span>
        <LayerButton
          active={false}
          label={
            viewMode === 'globe'
              ? 'Switch to Mapbox Globe'
              : viewMode === 'map'
                ? 'Switch to Command'
                : 'Switch to Cinematic Globe'
          }
          onClick={handleToggleViewMode}
        >
          {viewMode === 'globe' ? (
            <MapIcon size={18} />
          ) : viewMode === 'map' ? (
            <Monitor size={18} />
          ) : (
            <Globe size={18} />
          )}
        </LayerButton>
      </div>

      {/* Globe/Map layer toggles — primary, then collapsible secondary */}
      <div className="mt-3 flex flex-col items-center gap-1">
        <span className="mb-1 text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Layers
        </span>
        {LAYER_TOGGLES_PRIMARY.map((lt) => (
          <LayerButton
            key={lt.layer}
            active={activeLayers.has(lt.layer)}
            label={lt.label}
            count={layerStats[lt.layer]?.total ?? 0}
            onClick={() => handleToggleLayer(lt.layer)}
          >
            {lt.icon}
          </LayerButton>
        ))}
        {layersExtraVisible &&
          LAYER_TOGGLES_SECONDARY.map((lt) => (
            <LayerButton
              key={lt.layer}
              active={activeLayers.has(lt.layer)}
              label={lt.label}
              count={layerStats[lt.layer]?.total ?? 0}
              onClick={() => handleToggleLayer(lt.layer)}
            >
              {lt.icon}
            </LayerButton>
          ))}
        <MoreToggle
          expanded={layersExtraVisible}
          onClick={() => setShowLayersExtra((v) => !v)}
          label="layers"
        />
      </div>

      {/* Autonomous alert mute toggle — sits by Day/Night for quick reach */}
      <div className="mt-3 flex flex-col items-center gap-1">
        <span className="mb-1 text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Alerts
        </span>
        <LayerButton
          active={autonomousAlertsEnabled}
          label={autonomousAlertsEnabled ? 'Mute agent alerts' : 'Unmute agent alerts'}
          onClick={toggleAutonomousAlerts}
        >
          {autonomousAlertsEnabled ? <BellRing size={18} /> : <BellOff size={18} />}
        </LayerButton>
      </div>

      {/* Cyber layer toggles — primary, then collapsible secondary */}
      <div className="mt-3 flex flex-col items-center gap-1">
        <span className="mb-1 text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Cyber
        </span>
        {CYBER_LAYER_TOGGLES_PRIMARY.map((lt) => (
          <LayerButton
            key={lt.layer}
            active={activeLayers.has(lt.layer)}
            label={lt.label}
            count={layerStats[lt.layer]?.total ?? 0}
            onClick={() => handleToggleLayer(lt.layer)}
          >
            {lt.icon}
          </LayerButton>
        ))}
        {cyberExtraVisible &&
          CYBER_LAYER_TOGGLES_SECONDARY.map((lt) => (
            <LayerButton
              key={lt.layer}
              active={activeLayers.has(lt.layer)}
              label={lt.label}
              count={layerStats[lt.layer]?.total ?? 0}
              onClick={() => handleToggleLayer(lt.layer)}
            >
              {lt.icon}
            </LayerButton>
          ))}
        <MoreToggle
          expanded={cyberExtraVisible}
          onClick={() => setShowCyberExtra((v) => !v)}
          label="cyber"
        />
      </div>

      {/* Globe auto-rotation toggle (hidden when not on geo tab or in command view) */}
      <AutoRotateToggle />

      {/* Accent palette */}
      <AccentPaletteControl />

      {/* Page scroll arrows */}
      <SidebarScrollControl />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <LayerButton active={false} label="Settings" onClick={() => setSettingsOpen(true)}>
        <Settings size={18} />
      </LayerButton>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </aside>
  );
}

import { create } from 'zustand';
import type {
  BreakingAlertPayload,
  BreakingAlertState,
  CommandPopupData,
  GlobeArc,
  GlobeLayer,
  GlobeMarker,
  Hotspot,
  Severity,
  ViewMode,
  ViewportBounds,
  ZoomTier,
} from '@/lib/types';

/** Derive ZoomTier from a numeric zoom level */
export function zoomToTier(zoom: number): ZoomTier {
  if (zoom < 5) return 'global';
  if (zoom < 10) return 'country';
  if (zoom < 15) return 'city';
  return 'street';
}

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

// 'standard' = Mapbox Standard v3 (3D terrain/buildings + dynamic lighting).
// The other three are classic styles the neon CRT theme restyles in theme.ts.
export type MapBaseStyle = 'dark' | 'satellite' | 'terrain' | 'standard';

/** Hero visualization tab. Eight situation lenses on the threat-network data:
 *   - `geo`       Map / globe / command view
 *   - `timeline`  D3 CVE swim-lane (lifecycle)
 *   - `graph`     Hierarchical tree (top-down kill chain) — default for the
 *                  'GRAPH' tab slot in the UI. Replaces the prior Sigma.js
 *                  force-directed lens which had no semantic spatial encoding.
 *   - `rings`     Concentric rings — apex actor at the center, network fans out
 *   - `matrix`    MITRE ATT&CK matrix — actors × tactics, cells = technique density
 *   - `sankey`    Sankey flow — actors → tactics → victim sectors
 *   - `live`      Shell-free live monitor video surface
 *   - `forecast`  AEGIS prediction surface
 *
 * Selecting an actor in any lens persists via `selectedActorId` so the highlight
 * follows the user across lenses. */
export type HeroTab =
  | 'geo'
  | 'warroom'
  | 'timeline'
  | 'graph'
  | 'rings'
  | 'matrix'
  | 'sankey'
  | 'live'
  | 'forecast';

export type OverlayLayerType = 'military_base' | 'infrastructure' | 'conflict_zone';

export interface HoveredOverlayFeature {
  layerType: OverlayLayerType;
  featureId: string;
  properties: Record<string, unknown>;
  cursorPosition: { x: number; y: number };
}

export interface AttentionPulse {
  id: string;
  lat: number;
  lon: number;
  label: string;
  color: string;
  duration: number;
  startTime: number;
}

interface MapState {
  // View mode
  viewMode: ViewMode;

  // Hero visualization tab (independent of viewMode — only the GEO tab consumes viewMode)
  heroTab: HeroTab;

  /** Cross-lens selected threat actor. When non-null, every threat-network lens
   * (graph/rings/matrix/sankey) highlights this actor's path. Selecting in one
   * lens follows you to the others. Click null space (or call setSelectedActorId(null))
   * to clear. */
  selectedActorId: string | null;

  // Camera
  viewState: MapViewState;
  isFlying: boolean;
  /**
   * Agent navigation lock. True after the agent calls `flyTo(..., { lock: true })`
   * — i.e. an explicit "fly there" tool result — and stays true until the user
   * physically engages (drag end via `clearNavigationLock`) OR clicks the
   * auto-rotate toggle. Read by `useAutoRotatePause` as an indefinite pause
   * source so the rotation doesn't drift the user off Max's target.
   *
   * Independent of `isFlying` (the 2-second animation flag). The two can both
   * be true momentarily; `isFlying` clears on its timer, `navigationLocked`
   * persists until release.
   */
  navigationLocked: boolean;

  // Layers
  activeLayers: Set<GlobeLayer>;

  // Selection
  selectedMarkerId: string | null;
  hoveredMarkerId: string | null;
  // Which surface set the current hover: a real globe marker ('map') or a
  // LAYER INTELLIGENCE drawer row ('list'). For 'list', the row-driven flyout
  // owns the card, so MapMarkerOverlay suppresses its far-away map card.
  hoverSource: 'map' | 'list' | null;
  selectedHotspot: Hotspot | null;

  // Data (shared types with globe)
  markers: GlobeMarker[];
  arcs: GlobeArc[];
  hotspots: Hotspot[];
  threatLevel: number;

  // Map-specific
  breakingAlert: BreakingAlertState;
  categoryFilter: Set<string> | null;
  highlightedMarkerIds: string[];

  // Command View
  commandPopupData: CommandPopupData | null;

  // Semantic zoom
  currentZoomTier: ZoomTier;
  viewportBounds: ViewportBounds | null;

  // Attention pulses
  attentionPulses: AttentionPulse[];

  // Sticky hover lock (prevents card dismiss when cursor moves from marker to card)
  hoverLocked: boolean;

  // Cluster hover tooltip data
  hoveredClusterData: {
    clusterId: number;
    pointCount: number;
    categories: Record<string, number>;
    lat: number;
    lon: number;
  } | null;

  // Deal cluster hover tooltip data
  hoveredDealClusterData: {
    clusterId: number;
    pointCount: number;
    lat: number;
    lon: number;
  } | null;

  // Overlay visibility (category filter + zoom indicator)
  mapOverlaysVisible: boolean;

  // Map base style
  baseStyle: MapBaseStyle;

  // Layer intelligence drawer (Mapbox mode only)
  layerDrawerOpen: boolean;
  activeLayerDrawer: GlobeLayer | null;
  isolatedLayer: GlobeLayer | null;
  // Severity legend filter — narrows the drawer list + globe markers to one
  // severity. Cleared alongside isolatedLayer.
  severityFilter: Severity | null;

  // Coordinate readout visibility
  showCoordinateReadout: boolean;

  // Overlay hover (military bases, infrastructure, conflict zones)
  hoveredOverlayFeature: HoveredOverlayFeature | null;
  overlayHoverLocked: boolean;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setHeroTab: (tab: HeroTab) => void;
  setSelectedActorId: (actorId: string | null) => void;
  setViewState: (viewState: MapViewState) => void;
  flyTo: (lat: number, lon: number, zoom?: number, options?: { lock?: boolean }) => void;
  clearNavigationLock: () => void;
  resetView: () => void;
  toggleLayer: (layer: GlobeLayer) => void;
  setLayerActive: (layer: GlobeLayer, active: boolean) => void;
  selectMarker: (id: string | null) => void;
  hoverMarker: (id: string | null, source?: 'map' | 'list') => void;
  selectHotspot: (hotspot: Hotspot | null) => void;
  setMarkers: (markers: GlobeMarker[]) => void;
  setArcs: (arcs: GlobeArc[]) => void;
  setHotspots: (hotspots: Hotspot[]) => void;
  setThreatLevel: (level: number) => void;
  /**
   * Raise the hero breaking-alert banner. Takes the whole payload — the old
   * two-arg `(alertId, location)` shape forced every caller to discard the
   * headline it already had in hand, which is why the banner could only ever
   * render a place name.
   */
  triggerBreakingAlert: (payload: BreakingAlertPayload) => void;
  clearBreakingAlert: () => void;
  setCategoryFilter: (categories: Set<string> | null) => void;
  highlightMarkers: (ids: string[]) => void;
  setCommandPopupData: (data: CommandPopupData | null) => void;
  setCurrentZoomTier: (tier: ZoomTier) => void;
  setViewportBounds: (bounds: ViewportBounds | null) => void;
  setHoverLocked: (locked: boolean) => void;
  setHoveredClusterData: (
    data: {
      clusterId: number;
      pointCount: number;
      categories: Record<string, number>;
      lat: number;
      lon: number;
    } | null,
  ) => void;
  setHoveredDealClusterData: (
    data: {
      clusterId: number;
      pointCount: number;
      lat: number;
      lon: number;
    } | null,
  ) => void;
  toggleMapOverlays: () => void;
  setBaseStyle: (style: MapBaseStyle) => void;
  openLayerDrawer: (layer: GlobeLayer) => void;
  closeLayerDrawer: () => void;
  setIsolatedLayer: (layer: GlobeLayer | null) => void;
  setSeverityFilter: (severity: Severity | null) => void;
  toggleCoordinateReadout: () => void;
  addAttentionPulse: (pulse: AttentionPulse) => void;
  removeAttentionPulse: (id: string) => void;
  setHoveredOverlayFeature: (feature: HoveredOverlayFeature | null) => void;
  setOverlayHoverLocked: (locked: boolean) => void;
}

const DEFAULT_VIEW_STATE: MapViewState = {
  longitude: 0,
  latitude: 20,
  zoom: 1.8,
  bearing: 0,
  pitch: 0,
};

export const COMMAND_VIEW_STATE: MapViewState = {
  longitude: 0,
  latitude: 20,
  zoom: 1.0,
  bearing: 0,
  pitch: 0,
};

const DEFAULT_LAYERS: GlobeLayer[] = [
  'markers',
  'threatRings',
  'dayNight',
  'arcs',
  'agentActivity',
  // Cyber primary streams default-on; secondary streams toggle in via the sidebar
  'cyberCVEs',
  'cyberBreaches',
  'cyberThreatActors',
];

export const useMapStore = create<MapState>((set, get) => ({
  viewMode: 'map',

  heroTab: 'geo',
  selectedActorId: null,

  viewState: DEFAULT_VIEW_STATE,
  isFlying: false,
  navigationLocked: false,

  activeLayers: new Set<GlobeLayer>(DEFAULT_LAYERS),

  selectedMarkerId: null,
  hoveredMarkerId: null,
  hoverSource: null,
  selectedHotspot: null,

  markers: [],
  arcs: [],
  hotspots: [],
  threatLevel: 0.3,

  breakingAlert: { active: false, alertId: null, location: null },
  categoryFilter: null,
  highlightedMarkerIds: [],

  commandPopupData: null,

  currentZoomTier: 'global',
  viewportBounds: null,

  attentionPulses: [],

  hoverLocked: false,

  hoveredClusterData: null,
  hoveredDealClusterData: null,

  // The zoom-tier breadcrumb (MapZoomIndicator) is OFF by default — it sat
  // dead-center over the globe, occluding the imagery, and duplicates the
  // corner zoom controls. Still available via Settings → "Zoom Indicator" for
  // anyone who wants it. The main viewing area stays clean.
  mapOverlaysVisible: false,

  // Satellite is the dominant hero view — the deck lands on real Earth imagery.
  baseStyle: 'satellite',

  layerDrawerOpen: false,
  activeLayerDrawer: null,
  isolatedLayer: null,
  severityFilter: null,

  showCoordinateReadout: false,

  hoveredOverlayFeature: null,
  overlayHoverLocked: false,

  setViewMode: (mode) =>
    set(
      mode === 'command'
        ? {
            viewMode: mode,
            viewState: COMMAND_VIEW_STATE,
            commandPopupData: null,
            layerDrawerOpen: false,
            isolatedLayer: null,
            severityFilter: null,
          }
        : {
            viewMode: mode,
            commandPopupData: null,
            layerDrawerOpen: mode === 'map' && get().layerDrawerOpen,
            isolatedLayer: null,
            severityFilter: null,
          },
    ),

  setHeroTab: (tab) => set({ heroTab: tab }),
  setSelectedActorId: (actorId) => set({ selectedActorId: actorId }),

  setViewState: (viewState) => set({ viewState }),

  flyTo: (lat, lon, zoom, options) => {
    set({
      viewState: {
        longitude: lon,
        latitude: lat,
        zoom: zoom ?? 6,
        bearing: 0,
        pitch: 0,
      },
      isFlying: true,
      // Only explicit "fly there" tool results pass { lock: true }. Incidental
      // flyTo from place_markers / draw_attention leaves the lock alone so
      // rotation can resume after markers fade. See plan §"Callers that opt in".
      ...(options?.lock ? { navigationLocked: true } : {}),
    });
    // Reset flying flag after animation
    setTimeout(() => set({ isFlying: false }), 2000);
  },

  clearNavigationLock: () => set({ navigationLocked: false }),

  resetView: () => {
    const { viewMode } = get();
    set({
      viewState: viewMode === 'command' ? COMMAND_VIEW_STATE : DEFAULT_VIEW_STATE,
      isFlying: false,
      // Reset is an explicit "I'm taking control" gesture — release any
      // navigation lock that Max set with a previous flyTo so rotation can
      // resume (subject to the zoom-gate + markers-present rules).
      navigationLocked: false,
      selectedMarkerId: null,
      selectedHotspot: null,
      // Reset also drops any layer isolation / severity filter so the globe
      // returns to its full, unfiltered state.
      isolatedLayer: null,
      severityFilter: null,
    });
  },

  toggleLayer: (layer) => {
    set((state) => {
      const next = new Set(state.activeLayers);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return { activeLayers: next };
    });
  },

  setLayerActive: (layer, active) => {
    set((state) => {
      const next = new Set(state.activeLayers);
      if (active) next.add(layer);
      else next.delete(layer);
      return { activeLayers: next };
    });
  },

  selectMarker: (id) => set({ selectedMarkerId: id }),
  hoverMarker: (id, source = 'map') =>
    set(
      id != null
        ? {
            hoveredMarkerId: id,
            hoverSource: source,
            hoveredOverlayFeature: null,
            overlayHoverLocked: false,
          }
        : { hoveredMarkerId: id, hoverSource: null },
    ),
  selectHotspot: (hotspot) => set({ selectedHotspot: hotspot }),
  setMarkers: (markers) => set({ markers }),
  setArcs: (arcs) => set({ arcs }),
  setHotspots: (hotspots) => set({ hotspots }),
  setThreatLevel: (level) => set({ threatLevel: Math.max(0, Math.min(1, level)) }),

  triggerBreakingAlert: (payload) => {
    set({
      breakingAlert: { active: true, ...payload },
    });
  },

  clearBreakingAlert: () => {
    set({
      breakingAlert: { active: false, alertId: null, location: null },
    });
  },

  setCategoryFilter: (categories) => set({ categoryFilter: categories }),
  highlightMarkers: (ids) => set({ highlightedMarkerIds: ids }),
  setCommandPopupData: (data) => set({ commandPopupData: data }),

  setCurrentZoomTier: (tier) => set({ currentZoomTier: tier }),
  setViewportBounds: (bounds) => set({ viewportBounds: bounds }),

  setHoverLocked: (locked) => set({ hoverLocked: locked }),

  setHoveredClusterData: (data) => set({ hoveredClusterData: data }),
  setHoveredDealClusterData: (data) => set({ hoveredDealClusterData: data }),

  toggleMapOverlays: () => {
    set((state) => {
      const next = !state.mapOverlaysVisible;
      try {
        localStorage.setItem('klammer-map-overlays', JSON.stringify(next));
      } catch {
        // localStorage full or unavailable — ignore
      }
      return { mapOverlaysVisible: next };
    });
  },

  setBaseStyle: (style) => {
    set({ baseStyle: style });
    try {
      localStorage.setItem('klammer-map-base-style', style);
    } catch {
      // localStorage full or unavailable — ignore
    }
  },

  openLayerDrawer: (layer) =>
    set((state) => ({
      activeLayerDrawer: layer,
      layerDrawerOpen: true,
      // Switching to a different layer drops any isolation / severity filter
      // scoped to the previous layer so the new drawer opens clean.
      ...(state.activeLayerDrawer !== layer ? { isolatedLayer: null, severityFilter: null } : {}),
    })),

  closeLayerDrawer: () =>
    set({ layerDrawerOpen: false, isolatedLayer: null, severityFilter: null }),

  setIsolatedLayer: (layer) => set({ isolatedLayer: layer }),
  setSeverityFilter: (severity) => set({ severityFilter: severity }),

  toggleCoordinateReadout: () => {
    set((state) => {
      const next = !state.showCoordinateReadout;
      try {
        localStorage.setItem('klammer-coordinate-readout', JSON.stringify(next));
      } catch {
        // localStorage full or unavailable — ignore
      }
      return { showCoordinateReadout: next };
    });
  },

  addAttentionPulse: (pulse) => {
    set((state) => ({
      attentionPulses: [...state.attentionPulses, pulse],
    }));
  },

  removeAttentionPulse: (id) => {
    set((state) => ({
      attentionPulses: state.attentionPulses.filter((p) => p.id !== id),
    }));
  },

  setHoveredOverlayFeature: (feature) =>
    set(
      feature != null
        ? {
            hoveredOverlayFeature: feature,
            hoveredMarkerId: null,
            hoveredClusterData: null,
            hoveredDealClusterData: null,
            hoverLocked: false,
          }
        : { hoveredOverlayFeature: feature },
    ),

  setOverlayHoverLocked: (locked) => set({ overlayHoverLocked: locked }),
}));

// Hydrate persisted settings from localStorage after store creation (client-only)
// to avoid SSR/client mismatch from reading localStorage during store init.
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('klammer-map-overlays');
    if (stored !== null) {
      useMapStore.setState({ mapOverlaysVisible: JSON.parse(stored) as boolean });
    }
  } catch {
    // localStorage unavailable — keep default
  }

  try {
    const storedStyle = localStorage.getItem('klammer-map-base-style');
    if (
      storedStyle === 'dark' ||
      storedStyle === 'satellite' ||
      storedStyle === 'terrain' ||
      storedStyle === 'standard'
    ) {
      useMapStore.setState({ baseStyle: storedStyle });
    }
  } catch {
    // localStorage unavailable — keep default
  }

  try {
    const storedReadout = localStorage.getItem('klammer-coordinate-readout');
    if (storedReadout !== null) {
      useMapStore.setState({ showCoordinateReadout: JSON.parse(storedReadout) as boolean });
    }
  } catch {
    // localStorage unavailable — keep default
  }
}

import { create } from 'zustand';
import type { GlobeArc, GlobeLayer, GlobeMarker, Hotspot } from '@/lib/types';

interface GlobeState {
  // Camera
  cameraTarget: [number, number, number] | null;
  isFlying: boolean;
  /**
   * User preference: should the hero globe slowly rotate in place?
   * Persisted via localStorage `klammer-auto-rotate`. Drives both the R3F
   * globe and the Mapbox globe via the shared `useAutoRotatePause` hook.
   * The transient "is currently spinning right now" boolean is held in refs
   * inside each controller — do NOT conflate them.
   */
  autoRotateEnabled: boolean;

  // Layers
  activeLayers: Set<GlobeLayer>;

  // Selection
  selectedMarkerId: string | null;
  hoveredMarkerId: string | null;
  selectedHotspot: Hotspot | null;

  // Data
  markers: GlobeMarker[];
  arcs: GlobeArc[];
  hotspots: Hotspot[];
  threatLevel: number; // 0-1 aggregate

  // Zoom control (decoupled store → Three.js communication)
  pendingGlobeZoom: 'in' | 'out' | 'reset' | null;

  // Actions
  flyTo: (lat: number, lon: number) => void;
  resetCamera: () => void;
  toggleLayer: (layer: GlobeLayer) => void;
  setLayerActive: (layer: GlobeLayer, active: boolean) => void;
  selectMarker: (id: string | null) => void;
  hoverMarker: (id: string | null) => void;
  selectHotspot: (hotspot: Hotspot | null) => void;
  setMarkers: (markers: GlobeMarker[]) => void;
  setArcs: (arcs: GlobeArc[]) => void;
  setHotspots: (hotspots: Hotspot[]) => void;
  setThreatLevel: (level: number) => void;
  setAutoRotateEnabled: (enabled: boolean) => void;
  requestGlobeZoom: (direction: 'in' | 'out' | 'reset') => void;
  clearPendingGlobeZoom: () => void;
}

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

const AUTO_ROTATE_STORAGE_KEY = 'klammer-auto-rotate';

export const useGlobeStore = create<GlobeState>((set) => ({
  cameraTarget: null,
  isFlying: false,
  // Default ON. Hydrated below (client-only) from localStorage if previously
  // toggled, OR coerced to false if the user has prefers-reduced-motion set.
  autoRotateEnabled: true,

  activeLayers: new Set<GlobeLayer>(DEFAULT_LAYERS),

  selectedMarkerId: null,
  hoveredMarkerId: null,
  selectedHotspot: null,

  markers: [],
  arcs: [],
  hotspots: [],
  threatLevel: 0.3,

  pendingGlobeZoom: null,

  flyTo: (lat, lon) => {
    // NOTE: we no longer mutate `autoRotateEnabled` here — `isFlying` is the
    // transient signal the rotation controllers pause on. The user preference
    // (autoRotateEnabled) is independent of in-flight camera animations.
    set({
      cameraTarget: [lat, lon, 0],
      isFlying: true,
    });
  },

  resetCamera: () => {
    set({
      cameraTarget: null,
      isFlying: false,
      selectedMarkerId: null,
      selectedHotspot: null,
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
  hoverMarker: (id) => set({ hoveredMarkerId: id }),
  selectHotspot: (hotspot) => set({ selectedHotspot: hotspot }),
  setMarkers: (markers) => set({ markers }),
  setArcs: (arcs) => set({ arcs }),
  setHotspots: (hotspots) => set({ hotspots }),
  setThreatLevel: (level) => set({ threatLevel: Math.max(0, Math.min(1, level)) }),
  setAutoRotateEnabled: (enabled) => {
    set({ autoRotateEnabled: enabled });
    try {
      localStorage.setItem(AUTO_ROTATE_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // localStorage full or unavailable — ignore
    }
  },
  requestGlobeZoom: (direction) => set({ pendingGlobeZoom: direction }),
  clearPendingGlobeZoom: () => set({ pendingGlobeZoom: null }),
}));

// Hydrate persisted settings from localStorage after store creation (client-only)
// to avoid SSR/client mismatch from reading localStorage during store init.
// Matches the pattern in map-store.ts.
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem(AUTO_ROTATE_STORAGE_KEY);
    if (stored !== null) {
      useGlobeStore.setState({ autoRotateEnabled: JSON.parse(stored) as boolean });
    }
  } catch {
    // localStorage unavailable — keep default
  }
}

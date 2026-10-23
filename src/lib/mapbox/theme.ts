/**
 * Apply Klammer WarGames/NORAD theme to Mapbox base styles.
 * Supports progressive basemap disclosure: detail fades in by zoom tier
 * while preserving the cinematic global view and overlay dominance.
 */

// biome-ignore lint/suspicious/noExplicitAny: Mapbox GL map instance — no typed SDK export
type MapInstance = any;

// ─── Layer Group Constants ──────────────────────────────────────────

/** Major highways — visible from z6+ */
const ROAD_MAJOR = ['road-motorway-trunk', 'tunnel-motorway-trunk', 'bridge-motorway-trunk'];

/** Primary/secondary roads — visible from z10+ */
const ROAD_PRIMARY = ['road-primary', 'road-secondary-tertiary'];

/** Local streets — visible from z13+ */
const ROAD_LOCAL = [
  'road-simple',
  'road-street',
  'road-path',
  'road-pedestrian',
  'road-rail',
  'tunnel-simple',
  'bridge-simple',
];

/** Points of interest labels — visible from z13+ */
const POI_LABELS = ['poi-label', 'natural-point-label', 'natural-line-label', 'waterway-label'];

/** Transit and road labels — visible from z15+ */
const TRANSIT_LABELS = ['transit-label', 'road-label-simple'];

/** Building footprints — visible from z13+ */
const BUILDING = ['building'];

/** All layers controlled by progressive disclosure */
const ALL_DISCLOSURE_LAYERS = [
  ...ROAD_MAJOR,
  ...ROAD_PRIMARY,
  ...ROAD_LOCAL,
  ...POI_LABELS,
  ...TRANSIT_LABELS,
  ...BUILDING,
];

/** 3D buildings fill-extrusion layer ID */
const KLAMMER_3D_BUILDINGS = 'klammer-3d-buildings';

// ─── Types ──────────────────────────────────────────────────────────

type StyleVariant = 'dark' | 'satellite' | 'terrain';

interface DisclosureColors {
  road: string;
  building2d: string;
  building3d: string;
  label: string;
  settlementBright: string;
  halo: string;
  labelHaloWidth: number;
  labelHaloBlur?: number;
  poiOpacity: number;
  transitOpacity: number;
}

interface ThemeOptions {
  skipDisclosure?: boolean;
}

// ─── Safe Property Helpers ──────────────────────────────────────────

function safePaint(map: MapInstance, layer: string, prop: string, value: unknown) {
  try {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
  } catch {
    // Layer or property not available in this style version
  }
}

function safeLayout(map: MapInstance, layer: string, prop: string, value: unknown) {
  try {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, prop, value);
  } catch {
    // Layer or property not available in this style version
  }
}

function setZoomRange(map: MapInstance, layer: string, min: number, max: number) {
  try {
    if (map.getLayer(layer)) map.setLayerZoomRange(layer, min, max);
  } catch {
    // Layer not available in this style version
  }
}

// ─── Utility Functions ──────────────────────────────────────────────

/** Find the first symbol layer for 3D building insertion point */
function findFirstLabelLayer(map: MapInstance): string | undefined {
  try {
    const layers = map.getStyle()?.layers;
    if (!layers) return undefined;
    for (const layer of layers) {
      if (layer.type === 'symbol') return layer.id;
    }
  } catch {
    // Style not ready
  }
  return undefined;
}

/** Add 3D building extrusions — buildings "rise" from z14.5→z15.5 */
function add3DBuildings(map: MapInstance, colors: DisclosureColors): void {
  if (map.getLayer(KLAMMER_3D_BUILDINGS)) return;
  try {
    map.addLayer(
      {
        id: KLAMMER_3D_BUILDINGS,
        source: 'composite',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 14.5,
        paint: {
          'fill-extrusion-color': colors.building3d,
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14.5,
            0,
            15.5,
            ['coalesce', ['get', 'height'], 10],
          ],
          'fill-extrusion-base': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14.5,
            0,
            15.5,
            ['coalesce', ['get', 'min_height'], 0],
          ],
          'fill-extrusion-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14.5,
            0,
            15.5,
            0.5,
            18,
            0.6,
          ],
        },
      },
      findFirstLabelLayer(map),
    );
  } catch {
    // Source or layer not available
  }
}

/** Remove 3D building extrusion layer */
export function remove3DBuildings(map: MapInstance): void {
  try {
    if (map.getLayer(KLAMMER_3D_BUILDINGS)) {
      map.removeLayer(KLAMMER_3D_BUILDINGS);
    }
  } catch {
    // Layer not available
  }
}

// ─── Color Palettes ─────────────────────────────────────────────────

export function getDisclosureColors(variant: StyleVariant): DisclosureColors {
  switch (variant) {
    case 'satellite':
      return {
        road: '#2a3a4a',
        building2d: '#1a2a35',
        building3d: '#152530',
        label: '#f0f8ff',
        settlementBright: '#ffffff',
        halo: '#000000',
        labelHaloWidth: 2.5,
        labelHaloBlur: 1,
        poiOpacity: 0.9,
        transitOpacity: 0.85,
      };
    case 'terrain':
      return {
        road: '#223040',
        building2d: '#162530',
        building3d: '#12202a',
        label: '#a0d0e8',
        settlementBright: '#c0e4f0',
        halo: '#000000',
        labelHaloWidth: 1.5,
        poiOpacity: 0.85,
        transitOpacity: 0.75,
      };
    default:
      return {
        road: '#1a2a3a',
        building2d: '#111d2a',
        building3d: '#0f1a25',
        label: '#5a9ab8',
        settlementBright: '#8ab8d0',
        halo: '#070d1a',
        labelHaloWidth: 1,
        poiOpacity: 0.75,
        transitOpacity: 0.65,
      };
  }
}

export function getLightDisclosureColors(variant: StyleVariant): DisclosureColors {
  switch (variant) {
    case 'satellite':
      return {
        road: '#4a5a6a',
        building2d: '#c0c8d0',
        building3d: '#b0b8c0',
        label: '#5a7a8a',
        settlementBright: '#4a6a7a',
        halo: '#f0f0ee',
        labelHaloWidth: 1,
        poiOpacity: 0.6,
        transitOpacity: 0.5,
      };
    case 'terrain':
      return {
        road: '#8090a0',
        building2d: '#d0d5d8',
        building3d: '#c5cad0',
        label: '#6a8090',
        settlementBright: '#5a7080',
        halo: '#f0f0ee',
        labelHaloWidth: 1,
        poiOpacity: 0.6,
        transitOpacity: 0.5,
      };
    default:
      return {
        road: '#b0bcc5',
        building2d: '#d8dde0',
        building3d: '#d0d5d8',
        label: '#7a8a9a',
        settlementBright: '#5a7080',
        halo: '#f0f0ee',
        labelHaloWidth: 1,
        poiOpacity: 0.6,
        transitOpacity: 0.5,
      };
  }
}

// ─── Progressive Disclosure Engine ──────────────────────────────────

function applyProgressiveDisclosure(map: MapInstance, colors: DisclosureColors): void {
  // Make all disclosure layers visible
  for (const layer of ALL_DISCLOSURE_LAYERS) {
    safeLayout(map, layer, 'visibility', 'visible');
  }

  // ── Tier 1 (z6+): Major roads ──
  for (const layer of ROAD_MAJOR) {
    setZoomRange(map, layer, 5.5, 22);
    safePaint(map, layer, 'line-color', colors.road);
    safePaint(map, layer, 'line-opacity', ['interpolate', ['linear'], ['zoom'], 5.5, 0, 6.5, 0.4]);
    safePaint(map, layer, 'line-width', ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.5]);
  }

  // ── Tier 2 (z10+): Primary/secondary roads ──
  for (const layer of ROAD_PRIMARY) {
    setZoomRange(map, layer, 9.5, 22);
    safePaint(map, layer, 'line-color', colors.road);
    safePaint(map, layer, 'line-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      9.5,
      0,
      10.5,
      0.35,
    ]);
    safePaint(map, layer, 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.5]);
  }

  // Settlement labels: brighten at z10+
  // For satellite, start at the already-bright label color so labels are readable at all zooms
  const settlementBase = colors.label;
  for (const layer of [
    'settlement-major-label',
    'settlement-minor-label',
    'settlement-subdivision-label',
  ]) {
    safePaint(map, layer, 'text-color', [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      settlementBase,
      10,
      settlementBase,
      11,
      colors.settlementBright,
    ]);
  }

  // ── Tier 3 (z13+): Local streets, POI labels, 2D buildings ──
  for (const layer of ROAD_LOCAL) {
    setZoomRange(map, layer, 12.5, 22);
    safePaint(map, layer, 'line-color', colors.road);
    safePaint(map, layer, 'line-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      12.5,
      0,
      13.5,
      0.3,
    ]);
    safePaint(map, layer, 'line-width', ['interpolate', ['linear'], ['zoom'], 13, 0.5, 16, 1.0]);
  }

  for (const layer of BUILDING) {
    setZoomRange(map, layer, 12.5, 22);
    safePaint(map, layer, 'fill-color', colors.building2d);
    safePaint(map, layer, 'fill-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      12.5,
      0,
      13.5,
      0.4,
    ]);
  }

  for (const layer of POI_LABELS) {
    setZoomRange(map, layer, 12.5, 22);
    safePaint(map, layer, 'text-color', colors.label);
    safePaint(map, layer, 'text-halo-color', colors.halo);
    safePaint(map, layer, 'text-halo-width', colors.labelHaloWidth);
    if (colors.labelHaloBlur) {
      safePaint(map, layer, 'text-halo-blur', colors.labelHaloBlur);
    }
    safePaint(map, layer, 'text-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      12.5,
      0,
      13.5,
      colors.poiOpacity,
    ]);
  }

  // ── Tier 4 (z15+): Transit/road labels, 3D buildings ──
  for (const layer of TRANSIT_LABELS) {
    setZoomRange(map, layer, 14.5, 22);
    safePaint(map, layer, 'text-color', colors.label);
    safePaint(map, layer, 'text-halo-color', colors.halo);
    safePaint(map, layer, 'text-halo-width', colors.labelHaloWidth);
    if (colors.labelHaloBlur) {
      safePaint(map, layer, 'text-halo-blur', colors.labelHaloBlur);
    }
    safePaint(map, layer, 'text-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      14.5,
      0,
      15.5,
      colors.transitOpacity,
    ]);
  }

  add3DBuildings(map, colors);
}

/** For satellite mode: force ALL symbol layers to consistent white-on-black text */
export function applyUniformSatelliteLabels(map: MapInstance, colors: DisclosureColors): void {
  try {
    const layers = map.getStyle()?.layers;
    if (!layers) return;
    for (const layer of layers) {
      if (layer.type !== 'symbol') continue;
      safePaint(map, layer.id, 'text-color', colors.label);
      safePaint(map, layer.id, 'text-halo-color', colors.halo);
      safePaint(map, layer.id, 'text-halo-width', colors.labelHaloWidth);
      if (colors.labelHaloBlur) {
        safePaint(map, layer.id, 'text-halo-blur', colors.labelHaloBlur);
      }
    }
  } catch {
    // Style not ready
  }
}

/**
 * Satellite is photographic — the imagery IS the map, so it gets NONE of the
 * neon CRT cartography the vector styles get. Painting `admin-0-boundary`
 * #00ff41 over Google-Earth-grade imagery is exactly the "weird neon borders"
 * that made satellite look wrong. Here: soft neutral country outlines for
 * context, no state lines or boundary glow, and readable labels + roads that
 * still appear as you zoom in.
 */
function applySatelliteTheme(map: MapInstance, colors: DisclosureColors): void {
  // Faint country outlines — present for orientation, not shouting.
  for (const layer of ['admin-0-boundary', 'admin-0-boundary-disputed']) {
    safePaint(map, layer, 'line-color', '#ffffff');
    safePaint(map, layer, 'line-opacity', 0.22);
    safePaint(map, layer, 'line-width', 0.6);
  }
  // Kill the neon glow underlay and the busy state/province lines entirely.
  for (const layer of ['admin-0-boundary-bg', 'admin-1-boundary', 'admin-1-boundary-bg']) {
    safeLayout(map, layer, 'visibility', 'none');
  }
  // Roads + settlement labels still reveal on zoom (Google-Earth behaviour).
  applyProgressiveDisclosure(map, colors);
  // Uniform bright labels so place names stay readable over the imagery.
  applyUniformSatelliteLabels(map, colors);
}

// ─── Dark Theme ─────────────────────────────────────────────────────

export function applyKlammerTheme(
  map: MapInstance,
  styleVariant: StyleVariant = 'dark',
  options?: ThemeOptions,
): void {
  // Satellite gets the clean photographic treatment, never the neon vector one.
  if (styleVariant === 'satellite') {
    applySatelliteTheme(map, getDisclosureColors('satellite'));
    return;
  }

  // Background
  safePaint(map, 'background', 'background-color', '#070d1a');

  // Water
  safePaint(map, 'water', 'fill-color', '#0d2240');

  // Land
  for (const layer of ['land', 'landcover', 'landuse']) {
    safePaint(map, layer, 'fill-color', '#0a1628');
  }

  // Country borders — neon cyan
  for (const layer of ['admin-0-boundary', 'admin-0-boundary-bg', 'admin-0-boundary-disputed']) {
    safePaint(map, layer, 'line-color', '#00ff41');
    safePaint(map, layer, 'line-opacity', 0.7);
  }

  // State/province borders — subtle
  for (const layer of ['admin-1-boundary', 'admin-1-boundary-bg']) {
    safePaint(map, layer, 'line-color', '#00ff41');
    safePaint(map, layer, 'line-opacity', 0.25);
  }

  // Get disclosure colors early so base labels can use variant-specific values
  const colors = getDisclosureColors(styleVariant);

  // Labels — base styling (disclosure may override settlement labels)
  // For satellite, use bright label color so country/city names are readable
  const baseLabelColor = colors.label;
  for (const layer of [
    'country-label',
    'state-label',
    'settlement-major-label',
    'settlement-minor-label',
    'settlement-subdivision-label',
  ]) {
    safePaint(map, layer, 'text-color', baseLabelColor);
    safePaint(map, layer, 'text-halo-color', colors.halo);
    safePaint(map, layer, 'text-halo-width', colors.labelHaloWidth);
    if (colors.labelHaloBlur) {
      safePaint(map, layer, 'text-halo-blur', colors.labelHaloBlur);
    }
  }

  // Water labels
  for (const layer of ['water-point-label', 'water-line-label']) {
    safePaint(map, layer, 'text-color', '#1a4a7a');
  }

  // Progressive disclosure or hide all
  if (options?.skipDisclosure) {
    for (const layer of ALL_DISCLOSURE_LAYERS) {
      safeLayout(map, layer, 'visibility', 'none');
    }
    remove3DBuildings(map);
  } else {
    applyProgressiveDisclosure(map, colors);
  }

  // (Satellite is handled by the early return above via applySatelliteTheme.)
}

// ─── Light Theme ────────────────────────────────────────────────────

export function applyKlammerLightTheme(
  map: MapInstance,
  styleVariant: StyleVariant = 'dark',
  options?: ThemeOptions,
): void {
  // Satellite is theme-independent — the imagery is the same in light or dark;
  // use the same clean treatment as the dark path.
  if (styleVariant === 'satellite') {
    applySatelliteTheme(map, getLightDisclosureColors('satellite'));
    return;
  }

  // Background
  safePaint(map, 'background', 'background-color', '#e8eeee');

  // Water
  safePaint(map, 'water', 'fill-color', '#c8dce8');

  // Land
  for (const layer of ['land', 'landcover', 'landuse']) {
    safePaint(map, layer, 'fill-color', '#f0f0ee');
  }

  // Country borders
  for (const layer of ['admin-0-boundary', 'admin-0-boundary-bg', 'admin-0-boundary-disputed']) {
    safePaint(map, layer, 'line-color', '#0077aa');
    safePaint(map, layer, 'line-opacity', 0.6);
  }

  // State/province borders
  for (const layer of ['admin-1-boundary', 'admin-1-boundary-bg']) {
    safePaint(map, layer, 'line-color', '#0077aa');
    safePaint(map, layer, 'line-opacity', 0.25);
  }

  // Labels — base styling
  for (const layer of [
    'country-label',
    'state-label',
    'settlement-major-label',
    'settlement-minor-label',
    'settlement-subdivision-label',
  ]) {
    safePaint(map, layer, 'text-color', '#555555');
    safePaint(map, layer, 'text-halo-color', '#f0f0ee');
    safePaint(map, layer, 'text-halo-width', 1);
  }

  // Water labels
  for (const layer of ['water-point-label', 'water-line-label']) {
    safePaint(map, layer, 'text-color', '#6699bb');
  }

  // Progressive disclosure or hide all
  const lightColors = getLightDisclosureColors(styleVariant);
  if (options?.skipDisclosure) {
    for (const layer of ALL_DISCLOSURE_LAYERS) {
      safeLayout(map, layer, 'visibility', 'none');
    }
    remove3DBuildings(map);
  } else {
    applyProgressiveDisclosure(map, lightColors);
  }

  // (Satellite is handled by the early return above via applySatelliteTheme.)
}

// ─── Command View Themes ────────────────────────────────────────────

/**
 * Command View dark theme — NORAD tactical, no disclosure at any zoom.
 */
export function applyCommandTheme(map: MapInstance): void {
  applyKlammerTheme(map, 'dark', { skipDisclosure: true });

  // Enhanced country borders — brighter cyan-green, thicker
  for (const layer of ['admin-0-boundary', 'admin-0-boundary-bg', 'admin-0-boundary-disputed']) {
    safePaint(map, layer, 'line-color', '#00ffaa');
    safePaint(map, layer, 'line-opacity', 0.9);
    safePaint(map, layer, 'line-width', 1.5);
  }

  // State borders slightly more visible
  for (const layer of ['admin-1-boundary', 'admin-1-boundary-bg']) {
    safePaint(map, layer, 'line-color', '#00ffaa');
    safePaint(map, layer, 'line-opacity', 0.35);
  }

  // Dimmer labels for command view
  for (const layer of [
    'country-label',
    'state-label',
    'settlement-major-label',
    'settlement-minor-label',
    'settlement-subdivision-label',
  ]) {
    safePaint(map, layer, 'text-color', '#334455');
    safePaint(map, layer, 'text-halo-color', '#070d1a');
    safePaint(map, layer, 'text-halo-width', 1);
  }
}

/**
 * Command View light theme — clean tactical, no disclosure.
 */
export function applyCommandLightTheme(map: MapInstance): void {
  applyKlammerLightTheme(map, 'dark', { skipDisclosure: true });

  // Enhanced borders — teal, thicker
  for (const layer of ['admin-0-boundary', 'admin-0-boundary-bg', 'admin-0-boundary-disputed']) {
    safePaint(map, layer, 'line-color', '#00aa88');
    safePaint(map, layer, 'line-opacity', 0.8);
    safePaint(map, layer, 'line-width', 1.5);
  }

  // State borders slightly more visible
  for (const layer of ['admin-1-boundary', 'admin-1-boundary-bg']) {
    safePaint(map, layer, 'line-color', '#00aa88');
    safePaint(map, layer, 'line-opacity', 0.3);
  }

  // Dimmer labels
  for (const layer of [
    'country-label',
    'state-label',
    'settlement-major-label',
    'settlement-minor-label',
    'settlement-subdivision-label',
  ]) {
    safePaint(map, layer, 'text-color', '#889999');
    safePaint(map, layer, 'text-halo-color', '#f0f0ee');
    safePaint(map, layer, 'text-halo-width', 1);
  }
}

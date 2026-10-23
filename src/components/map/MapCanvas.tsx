'use client';

import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  type ErrorEvent,
  type MapMouseEvent,
  type MapRef,
  type ViewStateChangeEvent,
} from 'react-map-gl/mapbox';
import { classifyMapboxError, reportMapboxError } from '@/lib/mapbox/error-classify';
import { installMapboxSourceRemovalGuard, resetMapboxTerrain } from '@/lib/mapbox/terrain';
import {
  applyKlammerLightTheme,
  applyKlammerTheme,
  applyUniformSatelliteLabels,
  getDisclosureColors,
  getLightDisclosureColors,
} from '@/lib/mapbox/theme';
import type { ViewportFeature } from '@/lib/mapbox/viewport-features';
import { queryFeaturesAtPoint } from '@/lib/mapbox/viewport-features';
import { type MapBaseStyle, useMapStore, zoomToTier } from '@/lib/store/map-store';
import { isCyberMarker } from '@/lib/utils/cyber-markers';
import { prefillAgent } from '@/lib/utils/panel-actions';
import { MapAgentIntelLayer } from './MapAgentIntelLayer';
import { MapArcLayer } from './MapArcLayer';
import { MapAttentionPulseLayer } from './MapAttentionPulseLayer';
import { MapAutoRotation } from './MapAutoRotation';
import { MapConflictZonesLayer } from './MapConflictZonesLayer';
import { MapContextMenu } from './MapContextMenu';
import { MapCoordinateReadout } from './MapCoordinateReadout';
import { MapDayNightLayer } from './MapDayNightLayer';
import { MapHeatmapLayer } from './MapHeatmapLayer';
import { MapInfrastructureLayer } from './MapInfrastructureLayer';
import { MapMarkerLayer } from './MapMarkerLayer';
import { MapMarkerOverlay } from './MapMarkerOverlay';
import { MapMilitaryBasesLayer } from './MapMilitaryBasesLayer';
import { MapOverlayHoverController } from './MapOverlayHoverController';
import { MapPoiPopup } from './MapPoiPopup';
import { MapThreatRingLayer } from './MapThreatRingLayer';
import { MapZoomIndicator } from './MapZoomIndicator';
import { OverlayHoverCard } from './OverlayHoverCard';

import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const TOKEN_VALID =
  MAPBOX_TOKEN && !MAPBOX_TOKEN.includes('placeholder') && MAPBOX_TOKEN.startsWith('pk.');
const TILT_UNLOCK_ZOOM = 13;
const FACILITY_TILT_ZOOM = 15;
const FACILITY_PITCH = 45;
// If the style hasn't finished loading within this window, treat the map as
// failed and surface the error card. A blocked blob: worker (CSP), an
// unavailable WebGL context, or a silent style-load hang all leave `layersReady`
// false forever with NO error event — this is the catch-all that turns a dead
// grey sphere into an actionable message. Generous, so a slow cold start on a
// loaded dev machine doesn't trip a false positive.
const INIT_WATCHDOG_MS = 10_000;

function applyGlobeAtmosphere(map: MapboxMap) {
  resetMapboxTerrain(map);

  try {
    map.setProjection({ name: 'globe' });
  } catch {
    // Projection can reject while a style is mid-reload.
  }

  resetMapboxTerrain(map);

  try {
    map.setFog({
      color: 'rgb(8, 12, 20)',
      'high-color': 'rgb(24, 48, 72)',
      'horizon-blend': 0.08,
      'space-color': 'rgb(0, 0, 0)',
      'star-intensity': 0.35,
    });
  } catch {
    // Fog is ornamental; the map stays functional without it.
  }
}

/**
 * Mapbox Standard v3 is a "black box" style — it exposes no classic layer ids
 * (`water`, `admin-0-boundary`, `country-label`, …), so the neon CRT theme in
 * theme.ts can't restyle it. It's driven through the config API instead. Each
 * call is wrapped because setConfigProperty rejects while a style is mid-reload,
 * same as setProjection.
 */
function applyStandardConfig(map: MapboxMap) {
  const set = (prop: string, value: unknown) => {
    try {
      // setConfigProperty is v3-only; the mapbox-gl types expose it.
      (
        map as unknown as { setConfigProperty: (i: string, p: string, v: unknown) => void }
      ).setConfigProperty('basemap', prop, value);
    } catch {
      // mid-reload — the next style.load re-applies.
    }
  };
  set('lightPreset', 'night'); // closest to the deck's dark aesthetic
  set('theme', 'monochrome');
  set('show3dObjects', true);
}

/**
 * Apply the right cartography for the active base style: Standard v3 goes
 * through its config API, the classic styles through the neon CRT theme fn.
 * The `standard` narrowing means `themeFn` only ever sees the three classic
 * variants it's typed for. Centralized so the useEffect and both cold-start
 * paths in handleLoad can't drift.
 */
function applyBaseTheme(
  map: MapboxMap,
  baseStyle: MapBaseStyle,
  themeFn: (map: MapboxMap, variant: 'dark' | 'satellite' | 'terrain') => void,
): void {
  if (baseStyle === 'standard') {
    applyStandardConfig(map);
    return;
  }
  themeFn(map, baseStyle);
}

function applyPitchGuard(map: MapboxMap, zoom: number, pitch: number, tiltApplied: boolean) {
  if (zoom < TILT_UNLOCK_ZOOM) {
    map.setMaxPitch(0);
    if (pitch > 0.5) {
      map.easeTo({ pitch: 0, duration: 250 });
    }
    return false;
  }

  map.setMaxPitch(60);
  if (zoom >= FACILITY_TILT_ZOOM && !tiltApplied && pitch < 20) {
    map.easeTo({ pitch: FACILITY_PITCH, duration: 500 });
    return true;
  }

  return zoom >= FACILITY_TILT_ZOOM ? tiltApplied : false;
}

// ─── Map Instance Export ───
// Module-level getter so use-agent-stream.ts can access the map for viewport capture.

let _mapInstance: MapboxMap | null = null;
export function getMapInstance(): MapboxMap | null {
  return _mapInstance;
}

export function MapCanvas() {
  const mapRef = useRef<MapRef>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRemovalGuardCleanupRef = useRef<(() => void) | null>(null);
  const facilityTiltAppliedRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [layersReady, setLayersReady] = useState(false);
  // Bumping this remounts <MapGL> — the retry affordance on the error card.
  const [mapKey, setMapKey] = useState(0);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    lat: number;
    lon: number;
    features: ViewportFeature[];
  } | null>(null);
  const [clickedPoi, setClickedPoi] = useState<{
    name: string;
    type: string;
    lat: number;
    lon: number;
  } | null>(null);
  const { resolvedTheme } = useTheme();
  // Mirror resolvedTheme into a ref so deferred callbacks (e.g. handleLoad's
  // map.once('style.load', ...)) read the latest value, not a stale closure.
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;
  const viewState = useMapStore((s) => s.viewState);
  const setViewState = useMapStore((s) => s.setViewState);
  const selectMarker = useMapStore((s) => s.selectMarker);
  const hoverMarker = useMapStore((s) => s.hoverMarker);
  const selectHotspot = useMapStore((s) => s.selectHotspot);
  const setHoverLocked = useMapStore((s) => s.setHoverLocked);
  const setHoveredClusterData = useMapStore((s) => s.setHoveredClusterData);
  const markers = useMapStore((s) => s.markers);
  const hotspots = useMapStore((s) => s.hotspots);
  const activeLayers = useMapStore((s) => s.activeLayers);
  const mapOverlaysVisible = useMapStore((s) => s.mapOverlaysVisible);
  const setCurrentZoomTier = useMapStore((s) => s.setCurrentZoomTier);
  const setViewportBounds = useMapStore((s) => s.setViewportBounds);
  const baseStyle = useMapStore((s) => s.baseStyle);

  const mapStyle = useMemo(() => {
    switch (baseStyle) {
      case 'satellite':
        return 'mapbox://styles/mapbox/satellite-streets-v12';
      case 'terrain':
        return 'mapbox://styles/mapbox/outdoors-v12';
      case 'standard':
        // Mapbox Standard v3 — config-driven (see applyStandardConfig).
        return 'mapbox://styles/mapbox/standard';
      default:
        return resolvedTheme === 'light'
          ? 'mapbox://styles/mapbox/light-v11'
          : 'mapbox://styles/mapbox/dark-v11';
    }
  }, [resolvedTheme, baseStyle]);

  // Re-apply theme when resolvedTheme or baseStyle changes.
  //
  // Note on listener ordering: child layer components (MapConflictZonesLayer,
  // MapInfrastructureLayer, etc.) register their own 'style.load' listeners.
  // React 19 commits child effects before parent effects, so those listeners
  // fire BEFORE this `apply` on every style.load. That's safe today because
  // child handlers only call addSource (which does not invoke _updateTerrain);
  // any future child handler that calls removeSource on style.load must guard
  // terrain itself (see resetMapboxTerrain).
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    setLayersReady(false);
    const themeFn = resolvedTheme === 'light' ? applyKlammerLightTheme : applyKlammerTheme;
    const apply = () => {
      resetMapboxTerrain(map);
      applyBaseTheme(map, baseStyle, themeFn);
      applyGlobeAtmosphere(map);
      facilityTiltAppliedRef.current = applyPitchGuard(
        map,
        map.getZoom(),
        map.getPitch(),
        facilityTiltAppliedRef.current,
      );
      setLayersReady(true);
    };
    // Apply immediately if style is already loaded (handles cached styles)
    if (map.isStyleLoaded()) apply();
    // Also listen for future style loads (use 'on' not 'once' to handle re-loads)
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [resolvedTheme, baseStyle]);

  // Satellite belt-and-suspenders: re-apply uniform labels after map becomes idle
  // (all tiles rendered). This catches labels from layers that load after style.load fires.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || baseStyle !== 'satellite') return;
    const colors =
      resolvedTheme === 'light'
        ? getLightDisclosureColors('satellite')
        : getDisclosureColors('satellite');
    const forceLabels = () => applyUniformSatelliteLabels(map, colors);
    map.on('idle', forceLabels);
    return () => {
      map.off('idle', forceLabels);
    };
  }, [baseStyle, resolvedTheme]);

  // Init watchdog — surface a dead map instead of a silent grey sphere.
  // Restarts with mapKey (retry) and clears the moment layers are ready.
  useEffect(() => {
    if (layersReady || mapError) return;
    const timer = setTimeout(() => {
      setMapError(
        'Map failed to initialize — tiles never rendered. Check the browser console: the usual cause is a blocked blob: worker (CSP worker-src) or an unavailable WebGL context.',
      );
    }, INIT_WATCHDOG_MS);
    return () => clearTimeout(timer);
    // Retry flips layersReady→false and mapError→null, which already re-arms
    // this effect — mapKey would be redundant in the deps.
  }, [layersReady, mapError]);

  // Cleanup timers and map instance on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      sourceRemovalGuardCleanupRef.current?.();
      sourceRemovalGuardCleanupRef.current = null;
      _mapInstance = null;
    };
  }, []);

  // Freeze map interactions while context menu or POI popup is open to prevent coordinate drift
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const menuOpen = contextMenu !== null || clickedPoi !== null;
    if (menuOpen) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    } else {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
    }
  }, [contextMenu, clickedPoi]);

  const handleMove = useCallback(
    (evt: ViewStateChangeEvent) => {
      setViewState(evt.viewState);

      // Dismiss context menu and POI popup on map move
      setContextMenu(null);
      setClickedPoi(null);

      // Update zoom tier
      setCurrentZoomTier(zoomToTier(evt.viewState.zoom));

      // Update viewport bounds
      const map = mapRef.current?.getMap();
      if (map) {
        facilityTiltAppliedRef.current = applyPitchGuard(
          map,
          evt.viewState.zoom,
          evt.viewState.pitch,
          facilityTiltAppliedRef.current,
        );
      }

      const bounds = map?.getBounds();
      if (bounds) {
        setViewportBounds({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      }
    },
    [setViewState, setCurrentZoomTier, setViewportBounds],
  );

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Export map instance for viewport capture
    _mapInstance = map;

    // Install before layersReady mounts react-map-gl Sources. React 19 replays
    // their effects in development, which can expose Mapbox's globe-projection
    // deferred-terrain race during removeSource(). See BUG-022.
    sourceRemovalGuardCleanupRef.current?.();
    sourceRemovalGuardCleanupRef.current = installMapboxSourceRemovalGuard(map);

    // Cold-start path: the theme useEffect bails on first mount because
    // react-map-gl lazy-initializes the underlying Map after the first commit,
    // so its `style.load` listener is never attached for the first paint.
    // Disable terrain here too — otherwise users who load the page with
    // baseStyle='terrain' persisted in localStorage hit the original crash
    // on their first source removal. See BUG-016.
    const themeFn = resolvedTheme === 'light' ? applyKlammerLightTheme : applyKlammerTheme;
    if (map.isStyleLoaded()) {
      resetMapboxTerrain(map);
      applyBaseTheme(map, baseStyle, themeFn);
      applyGlobeAtmosphere(map);
      facilityTiltAppliedRef.current = applyPitchGuard(
        map,
        map.getZoom(),
        map.getPitch(),
        facilityTiltAppliedRef.current,
      );
      setLayersReady(true);
    } else {
      // The once-callback can fire after the user toggles baseStyle/theme;
      // read fresh values from the store and ref instead of closing over them.
      map.once('style.load', () => {
        resetMapboxTerrain(map);
        const currentBaseStyle = useMapStore.getState().baseStyle;
        const currentThemeFn =
          resolvedThemeRef.current === 'light' ? applyKlammerLightTheme : applyKlammerTheme;
        applyBaseTheme(map, currentBaseStyle, currentThemeFn);
        applyGlobeAtmosphere(map);
        facilityTiltAppliedRef.current = applyPitchGuard(
          map,
          map.getZoom(),
          map.getPitch(),
          facilityTiltAppliedRef.current,
        );
        setLayersReady(true);
      });
    }

    // Set initial viewport bounds
    const bounds = map.getBounds();
    if (bounds) {
      setViewportBounds({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    }
    setCurrentZoomTier(zoomToTier(map.getZoom()));
    facilityTiltAppliedRef.current = applyPitchGuard(
      map,
      map.getZoom(),
      map.getPitch(),
      facilityTiltAppliedRef.current,
    );
  }, [setViewportBounds, setCurrentZoomTier, resolvedTheme, baseStyle]);

  const handleError = useCallback((evt: ErrorEvent) => {
    // Invalid token → swap in the error card. Benign transient tile fetches →
    // throttled console.warn (off the Next.js dev overlay). Real config/style
    // bugs stay loud on console.error. See @/lib/mapbox/error-classify.
    if (classifyMapboxError(evt) === 'auth') {
      setMapError('Invalid Mapbox access token. Update NEXT_PUBLIC_MAPBOX_TOKEN in .env.local');
      return;
    }
    reportMapboxError('[MapCanvas]', evt);
  }, []);

  const handleClick = useCallback(
    (evt: MapMouseEvent) => {
      // Dismiss context menu and POI popup on any click
      if (contextMenu) setContextMenu(null);
      if (clickedPoi) setClickedPoi(null);

      // Check for cluster click
      const clusterFeatures = evt.features?.filter(
        (f: GeoJSON.Feature & { layer?: { id?: string } }) => f.layer?.id === 'klammer-clusters',
      );
      if (clusterFeatures && clusterFeatures.length > 0) {
        const feature = clusterFeatures[0]!;
        const clusterId = feature.properties?.cluster_id as number;
        const map = mapRef.current?.getMap();
        if (map) {
          const source = map.getSource('klammer-markers') as GeoJSONSource | undefined;
          source?.getClusterExpansionZoom(clusterId, (err?: Error | null, zoom?: number | null) => {
            if (err || zoom == null) return;
            const geometry = feature.geometry as GeoJSON.Point;
            map.easeTo({
              center: geometry.coordinates as [number, number],
              zoom,
              duration: 500,
            });
          });
        }
        return;
      }

      // Check for marker click (including agent intel markers)
      const markerFeatures = evt.features?.filter(
        (f: GeoJSON.Feature & { layer?: { id?: string } }) =>
          f.layer?.id === 'klammer-unclustered-points' || f.layer?.id === 'agent-intel-dot',
      );
      if (markerFeatures && markerFeatures.length > 0) {
        const feature = markerFeatures[0]!;
        const markerId = feature.properties?.id as string;
        selectMarker(markerId);

        const hotspotId = markerId.replace('hotspot-', '');
        const hotspot = hotspots.find((h) => h.id === hotspotId);
        if (hotspot) {
          selectHotspot(hotspot);
        } else {
          selectHotspot(null);
        }

        // 1-click marker → Max: stage a contextual query for cyber markers so the
        // operator can ask without the second "Analyze" hop. The detail card from
        // selectMarker still opens for the read-only path; this only prefills the
        // command bar (no auto-send — respects agent cost, Rules #16/#26).
        // getState() reads fresh markers without a stale closure (Rule #24).
        const clickedMarker = useMapStore.getState().markers.find((m) => m.id === markerId);
        if (isCyberMarker(clickedMarker)) {
          prefillAgent(`Analyze ${clickedMarker.label}`, {
            sourcePanel: 'map',
            dataType: clickedMarker.cyberCategory,
            trendData: {
              label: clickedMarker.label,
              severity: clickedMarker.severity,
              cveId: clickedMarker.cveId,
              threatActorId: clickedMarker.threatActorId,
              breachId: clickedMarker.breachId,
              iocValue: clickedMarker.iocValue,
              url: clickedMarker.url,
            },
          });
        }
        return;
      }

      // Check for Mapbox POI click (poi-label / place-label layers)
      const map = mapRef.current?.getMap();
      if (map) {
        const poiLayers = map
          .getStyle()
          ?.layers?.filter((l) => l.id.includes('poi') || l.id.includes('place-label'))
          .map((l) => l.id);
        if (poiLayers && poiLayers.length > 0) {
          const poiAtPoint = map.queryRenderedFeatures(evt.point, { layers: poiLayers });
          if (poiAtPoint.length > 0) {
            const poi = poiAtPoint[0]!;
            const name = ((poi.properties?.name_en ?? poi.properties?.name) as string) ?? '';
            if (name) {
              setClickedPoi({
                name,
                type: (poi.properties?.class ?? poi.properties?.type ?? 'place') as string,
                lat: evt.lngLat.lat,
                lon: evt.lngLat.lng,
              });
              return;
            }
          }
        }
      }

      selectMarker(null);
      selectHotspot(null);
    },
    [hotspots, selectMarker, selectHotspot, contextMenu, clickedPoi],
  );

  const handleMouseEnter = useCallback(
    (evt: MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (map) map.getCanvas().style.cursor = 'pointer';

      // Clear any pending hover timer
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      // Cancel any pending dismiss timer (entering a new feature)
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      // Reset hover lock for new feature
      setHoverLocked(false);

      const feature = evt.features?.[0];
      if (!feature) return;

      // Cluster hover: show immediately, dismiss any marker card
      if (feature.layer?.id === 'klammer-clusters') {
        hoverMarker(null);
        const geom = feature.geometry as GeoJSON.Point;
        setHoveredClusterData({
          clusterId: (feature.properties?.cluster_id as number) ?? 0,
          pointCount: (feature.properties?.point_count as number) ?? 0,
          categories: {
            cve: (feature.properties?.cve_count as number) ?? 0,
            breach: (feature.properties?.breach_count as number) ?? 0,
            threat_actor: (feature.properties?.threat_actor_count as number) ?? 0,
            ai_incident: (feature.properties?.ai_incident_count as number) ?? 0,
            critical_infra: (feature.properties?.critical_infra_count as number) ?? 0,
            ioc: (feature.properties?.ioc_count as number) ?? 0,
            ai_safety: (feature.properties?.ai_safety_count as number) ?? 0,
            conflict: (feature.properties?.conflict_count as number) ?? 0,
            economic: (feature.properties?.economic_count as number) ?? 0,
            technology: (feature.properties?.technology_count as number) ?? 0,
            policy: (feature.properties?.policy_count as number) ?? 0,
            market: (feature.properties?.market_count as number) ?? 0,
            instability: (feature.properties?.instability_count as number) ?? 0,
            proliferation: (feature.properties?.proliferation_count as number) ?? 0,
            strategic: (feature.properties?.strategic_count as number) ?? 0,
            alternative: (feature.properties?.alternative_count as number) ?? 0,
          },
          lat: geom.coordinates[1]!,
          lon: geom.coordinates[0]!,
        });
        return;
      }

      // Marker hover: 150ms delay, dismiss any cluster card
      if (feature.properties?.id) {
        setHoveredClusterData(null);
        const markerId = feature.properties.id as string;
        hoverTimerRef.current = setTimeout(() => {
          hoverMarker(markerId);
        }, 150);
      }
    },
    [hoverMarker, setHoveredClusterData, setHoverLocked],
  );

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = '';

    // Clear hover delay timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Clear any existing dismiss timer
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    // Delayed dismiss: 300ms, check hoverLocked before clearing
    dismissTimerRef.current = setTimeout(() => {
      const { hoverLocked } = useMapStore.getState();
      if (!hoverLocked) {
        hoverMarker(null);
        setHoveredClusterData(null);
      }
    }, 300);
  }, [hoverMarker, setHoveredClusterData]);

  const handleMouseMove = useCallback((evt: MapMouseEvent) => {
    setCursorCoords({ lat: evt.lngLat.lat, lon: evt.lngLat.lng });
  }, []);

  const handleContextMenu = useCallback((evt: MapMouseEvent) => {
    evt.preventDefault();
    const map = mapRef.current?.getMap();
    if (!map) return;

    const features = queryFeaturesAtPoint(map, evt.point);

    setContextMenu({
      lat: evt.lngLat.lat,
      lon: evt.lngLat.lng,
      features,
    });
  }, []);

  if (!TOKEN_VALID || mapError) {
    // Two failure classes share the card. A missing token can only be fixed in
    // .env.local (retry is pointless). Any other failure — a blocked worker, a
    // dead WebGL context, the init watchdog firing — is worth a retry: the
    // remount clears mapError, bumps mapKey, and gives the map a fresh attempt.
    const tokenMissing = !TOKEN_VALID;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#070d1a]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-info)]/30 bg-[var(--color-info)]/5">
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-[var(--color-info)]"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <span className="max-w-md text-center text-xs font-mono text-[var(--text-secondary)] leading-relaxed">
          {mapError ?? 'Mapbox token required'}
        </span>
        {tokenMissing ? (
          <span className="max-w-xs text-center text-[10px] font-mono text-[var(--text-muted)] leading-relaxed">
            Add a valid Mapbox public token to{' '}
            <code className="text-[var(--color-info)]">NEXT_PUBLIC_MAPBOX_TOKEN</code> in .env.local
            and restart the dev server. Get one free at{' '}
            <code className="text-[var(--color-info)]">mapbox.com</code>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setMapError(null);
              setLayersReady(false);
              setMapKey((k) => k + 1);
            }}
            className="rounded border border-[var(--crt-glow)]/40 px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--crt-glow)] transition-colors hover:bg-[var(--crt-glow)]/10"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <MapGL
      key={mapKey}
      ref={mapRef}
      {...viewState}
      onMove={handleMove}
      onLoad={handleLoad}
      onError={handleError}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onContextMenu={handleContextMenu}
      interactiveLayerIds={[
        'klammer-clusters',
        'klammer-unclustered-points',
        'klammer-marker-labels',
        'agent-intel-dot',
      ]}
      mapStyle={mapStyle}
      mapboxAccessToken={MAPBOX_TOKEN}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
      logoPosition="bottom-right"
      maxZoom={20}
      minZoom={1}
      maxPitch={60}
    >
      {layersReady && (
        <>
          <MapMarkerLayer markers={markers} visible={activeLayers.has('markers')} />
          <MapAgentIntelLayer visible={activeLayers.has('agentActivity')} />
          <MapHeatmapLayer markers={markers} visible={activeLayers.has('heatmap')} />
          <MapThreatRingLayer markers={markers} visible={activeLayers.has('threatRings')} />
          <MapDayNightLayer visible={activeLayers.has('dayNight')} />
          <MapConflictZonesLayer visible={activeLayers.has('conflictZones')} />
          <MapMilitaryBasesLayer visible={activeLayers.has('militaryBases')} />
          <MapInfrastructureLayer visible={activeLayers.has('infrastructure')} />
          <MapArcLayer />
          <MapAttentionPulseLayer />
        </>
      )}
      {/* Auto-rotation controller — mounted outside the layersReady gate so
          it sets up its listeners as soon as the map style is available, not
          deferred until after every layer has fired. */}
      <MapAutoRotation />
      <MapMarkerOverlay />
      <MapOverlayHoverController />
      <OverlayHoverCard />
      {mapOverlaysVisible && <MapZoomIndicator />}
      <MapCoordinateReadout lat={cursorCoords?.lat ?? null} lon={cursorCoords?.lon ?? null} />
      {contextMenu && (
        <MapContextMenu
          lat={contextMenu.lat}
          lon={contextMenu.lon}
          features={contextMenu.features}
          onDismiss={() => setContextMenu(null)}
        />
      )}
      {clickedPoi && (
        <MapPoiPopup
          name={clickedPoi.name}
          type={clickedPoi.type}
          lat={clickedPoi.lat}
          lon={clickedPoi.lon}
          onDismiss={() => setClickedPoi(null)}
        />
      )}
    </MapGL>
  );
}

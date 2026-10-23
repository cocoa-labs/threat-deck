'use client';

import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';
import MapboxMap, {
  type ErrorEvent,
  type MapMouseEvent,
  type MapRef,
  type ViewStateChangeEvent,
} from 'react-map-gl/mapbox';
import { MapAgentIntelLayer } from '@/components/map/MapAgentIntelLayer';
import { MapArcLayer } from '@/components/map/MapArcLayer';
import { MapAttentionPulseLayer } from '@/components/map/MapAttentionPulseLayer';
import { MapConflictZonesLayer } from '@/components/map/MapConflictZonesLayer';
import { MapCoordinateReadout } from '@/components/map/MapCoordinateReadout';
import { MapDayNightLayer } from '@/components/map/MapDayNightLayer';
import { MapHeatmapLayer } from '@/components/map/MapHeatmapLayer';
import { MapInfrastructureLayer } from '@/components/map/MapInfrastructureLayer';
import { MapMarkerOverlay } from '@/components/map/MapMarkerOverlay';
import { MapMilitaryBasesLayer } from '@/components/map/MapMilitaryBasesLayer';
import { MapOverlayHoverController } from '@/components/map/MapOverlayHoverController';
import { MapThreatRingLayer } from '@/components/map/MapThreatRingLayer';
import { MapZoomIndicator } from '@/components/map/MapZoomIndicator';
import { OverlayHoverCard } from '@/components/map/OverlayHoverCard';
import { classifyMapboxError, reportMapboxError } from '@/lib/mapbox/error-classify';
import { applyCommandLightTheme, applyCommandTheme } from '@/lib/mapbox/theme';
import { useMapStore, zoomToTier } from '@/lib/store/map-store';
import { CommandCRTOverlay } from './CommandCRTOverlay';
import { CommandGridOverlay } from './CommandGridOverlay';
import { CommandMarkerLayer } from './CommandMarkerLayer';
import { CommandRadarSweep } from './CommandRadarSweep';
import { CommandVignetteOverlay } from './CommandVignetteOverlay';

import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const TOKEN_VALID =
  MAPBOX_TOKEN && !MAPBOX_TOKEN.includes('placeholder') && MAPBOX_TOKEN.startsWith('pk.');

export function CommandCanvas() {
  const mapRef = useRef<MapRef>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const { resolvedTheme } = useTheme();
  const viewState = useMapStore((s) => s.viewState);
  const setViewState = useMapStore((s) => s.setViewState);
  const markers = useMapStore((s) => s.markers);
  const hotspots = useMapStore((s) => s.hotspots);
  const activeLayers = useMapStore((s) => s.activeLayers);
  const mapOverlaysVisible = useMapStore((s) => s.mapOverlaysVisible);
  const selectHotspot = useMapStore((s) => s.selectHotspot);
  const selectMarker = useMapStore((s) => s.selectMarker);
  const hoverMarker = useMapStore((s) => s.hoverMarker);
  const setHoverLocked = useMapStore((s) => s.setHoverLocked);
  const setHoveredClusterData = useMapStore((s) => s.setHoveredClusterData);
  const setCurrentZoomTier = useMapStore((s) => s.setCurrentZoomTier);
  const setViewportBounds = useMapStore((s) => s.setViewportBounds);

  const mapStyle =
    resolvedTheme === 'light'
      ? 'mapbox://styles/mapbox/light-v11'
      : 'mapbox://styles/mapbox/dark-v11';

  // Re-apply theme when resolvedTheme changes
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const themeFn = resolvedTheme === 'light' ? applyCommandLightTheme : applyCommandTheme;
    const applyOnLoad = () => themeFn(map);
    map.once('style.load', applyOnLoad);
    return () => {
      map.off('style.load', applyOnLoad);
    };
  }, [resolvedTheme]);

  // Cleanup hover timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleMove = useCallback(
    (evt: ViewStateChangeEvent) => {
      setViewState(evt.viewState);
      setCurrentZoomTier(zoomToTier(evt.viewState.zoom));

      const bounds = mapRef.current?.getMap()?.getBounds();
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

    const themeFn = resolvedTheme === 'light' ? applyCommandLightTheme : applyCommandTheme;
    if (map.isStyleLoaded()) {
      themeFn(map);
    } else {
      map.once('style.load', () => themeFn(map));
    }
  }, [resolvedTheme]);

  const handleError = useCallback((evt: ErrorEvent) => {
    // Invalid token → swap in the error card. Benign transient tile fetches →
    // throttled console.warn (off the Next.js dev overlay). Real config/style
    // bugs stay loud on console.error. See @/lib/mapbox/error-classify.
    if (classifyMapboxError(evt) === 'auth') {
      setMapError('Invalid Mapbox access token. Update NEXT_PUBLIC_MAPBOX_TOKEN in .env.local');
      return;
    }
    reportMapboxError('[CommandCanvas]', evt);
  }, []);

  const handleClick = useCallback(
    (evt: MapMouseEvent) => {
      // Check for cluster click — expand into individual markers
      const clusterFeatures = evt.features?.filter(
        (f: GeoJSON.Feature & { layer?: { id?: string } }) => f.layer?.id === 'command-clusters',
      );
      if (clusterFeatures && clusterFeatures.length > 0) {
        const feature = clusterFeatures[0]!;
        const clusterId = feature.properties?.cluster_id as number;
        const map = mapRef.current?.getMap();
        if (map) {
          const source = map.getSource('command-markers') as mapboxgl.GeoJSONSource | undefined;
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

      // Check for NATO symbol marker click (including agent intel markers)
      const markerFeatures = evt.features?.filter(
        (f: GeoJSON.Feature & { layer?: { id?: string } }) =>
          f.layer?.id === 'command-nato-symbols' || f.layer?.id === 'agent-intel-dot',
      );
      if (markerFeatures && markerFeatures.length > 0) {
        const feature = markerFeatures[0]!;
        const markerId = feature.properties?.id as string;
        selectMarker(markerId);

        const hotspotId = markerId.replace('hotspot-', '');
        const hotspot = hotspots.find((h) => h.id === hotspotId);
        if (hotspot) {
          selectHotspot(hotspot);
        }
        return;
      }

      // Click on empty space — clear selection
      selectMarker(null);
      selectHotspot(null);
    },
    [hotspots, selectMarker, selectHotspot],
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
      if (feature.layer?.id === 'command-clusters') {
        hoverMarker(null);
        const geom = feature.geometry as GeoJSON.Point;
        setHoveredClusterData({
          clusterId: (feature.properties?.cluster_id as number) ?? 0,
          pointCount: (feature.properties?.point_count as number) ?? 0,
          categories: {
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

  if (!TOKEN_VALID || mapError) {
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
        <span className="text-xs font-mono text-[var(--text-secondary)]">
          {mapError ?? 'Mapbox token required'}
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapboxMap
        ref={mapRef}
        {...viewState}
        onMove={handleMove}
        onLoad={handleLoad}
        onError={handleError}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        interactiveLayerIds={['command-nato-symbols', 'command-clusters', 'agent-intel-dot']}
        mapStyle={mapStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        projection={{ name: 'mercator' }}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        logoPosition="bottom-right"
        maxZoom={20}
        minZoom={0.5}
      >
        <CommandMarkerLayer markers={markers} visible={activeLayers.has('markers')} />
        <MapAgentIntelLayer visible={activeLayers.has('agentActivity')} />
        <CommandGridOverlay />
        <MapHeatmapLayer
          markers={markers}
          visible={activeLayers.has('heatmap')}
          beforeId="command-nato-symbols"
        />
        <MapThreatRingLayer markers={markers} visible={activeLayers.has('threatRings')} />
        <MapDayNightLayer visible={activeLayers.has('dayNight')} />
        <MapConflictZonesLayer visible={activeLayers.has('conflictZones')} />
        <MapMilitaryBasesLayer visible={activeLayers.has('militaryBases')} />
        <MapInfrastructureLayer visible={activeLayers.has('infrastructure')} />
        <MapArcLayer />
        <MapMarkerOverlay />
        <MapOverlayHoverController />
        <OverlayHoverCard />
        <MapAttentionPulseLayer />
      </MapboxMap>

      {/* CSS/Canvas overlays */}
      <CommandRadarSweep />
      <CommandCRTOverlay />
      <CommandVignetteOverlay />
      {mapOverlaysVisible && <MapZoomIndicator />}
      <MapCoordinateReadout lat={cursorCoords?.lat ?? null} lon={cursorCoords?.lon ?? null} />
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/mapbox';
import { type OverlayLayerType, useMapStore } from '@/lib/store/map-store';

const LAYER_MAP: Record<string, OverlayLayerType> = {
  'military-bases-circle': 'military_base',
  'infrastructure-points': 'infrastructure',
  'conflict-zones-fill': 'conflict_zone',
};

const OVERLAY_LAYER_IDS = Object.keys(LAYER_MAP);

export function MapOverlayHoverController() {
  const { current: mapInstance } = useMap();
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredConflictIdRef = useRef<string | null>(null);

  const setHoveredOverlayFeature = useMapStore((s) => s.setHoveredOverlayFeature);
  const setOverlayHoverLocked = useMapStore((s) => s.setOverlayHoverLocked);

  const clearConflictHover = useCallback((map: mapboxgl.Map) => {
    if (hoveredConflictIdRef.current != null) {
      try {
        map.removeFeatureState({
          source: 'conflict-zones-source',
          id: hoveredConflictIdRef.current,
        });
      } catch {
        // source may not exist yet
      }
      hoveredConflictIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;

    const handleMouseEnter = (evt: mapboxgl.MapLayerMouseEvent) => {
      const feature = evt.features?.[0];
      if (!feature?.layer) return;

      const layerType = LAYER_MAP[feature.layer.id];
      if (!layerType) return;

      // Clear dismiss timer
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }

      const featureId = (feature.properties?.id as string) ?? '';
      const properties: Record<string, unknown> = {};
      if (feature.properties) {
        for (const [k, v] of Object.entries(feature.properties)) {
          properties[k] = v;
        }
      }

      setHoveredOverlayFeature({
        layerType,
        featureId,
        properties,
        cursorPosition: { x: evt.point.x, y: evt.point.y },
      });

      map.getCanvas().style.cursor = 'pointer';

      // Conflict zone: set feature state for highlight
      if (layerType === 'conflict_zone' && featureId) {
        clearConflictHover(map);
        try {
          map.setFeatureState({ source: 'conflict-zones-source', id: featureId }, { hover: true });
        } catch {
          // source may not exist yet
        }
        hoveredConflictIdRef.current = featureId;
      }
    };

    const handleMouseLeave = (_evt: mapboxgl.MapLayerMouseEvent) => {
      // Clear dismiss timer
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }

      map.getCanvas().style.cursor = '';

      dismissTimerRef.current = setTimeout(() => {
        const { overlayHoverLocked } = useMapStore.getState();
        if (!overlayHoverLocked) {
          setHoveredOverlayFeature(null);
          setOverlayHoverLocked(false);
          clearConflictHover(map);
        }
      }, 200);
    };

    // Register events for each overlay layer
    for (const layerId of OVERLAY_LAYER_IDS) {
      map.on('mouseenter', layerId, handleMouseEnter);
      map.on('mouseleave', layerId, handleMouseLeave);
    }

    return () => {
      for (const layerId of OVERLAY_LAYER_IDS) {
        map.off('mouseenter', layerId, handleMouseEnter);
        map.off('mouseleave', layerId, handleMouseLeave);
      }
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [mapInstance, setHoveredOverlayFeature, setOverlayHoverLocked, clearConflictHover]);

  return null;
}

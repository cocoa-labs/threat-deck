'use client';

import { useEffect, useRef } from 'react';
import { useGlobeStore } from '@/lib/store/globe-store';
import type { GlobeArc, GlobeMarker, Hotspot } from '@/lib/types';

// ─── Severity numeric weights for threat level calculation ───
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  info: 0.1,
};

// ─── Arc color by severity ───
const ARC_COLORS: Record<string, string> = {
  critical: '#ff0040',
  high: '#ff4444',
  medium: '#ffaa00',
  low: '#00ff41',
  info: '#666666',
};

/**
 * Converts Hotspot[] to GlobeMarker[] so they render as pulsing markers on the globe.
 */
function hotspotsToMarkers(hotspots: Hotspot[]): GlobeMarker[] {
  return hotspots.map((h) => ({
    id: `hotspot-${h.id}`,
    lat: h.lat,
    lon: h.lon,
    severity: h.severity,
    category: h.category,
    label: h.name,
    count: 1,
    source: 'osint',
  }));
}

/**
 * Generate arcs between hotspots that share severity or proximity,
 * creating a visual intelligence network on the globe.
 */
function generateArcs(hotspots: Hotspot[]): GlobeArc[] {
  const arcs: GlobeArc[] = [];

  // Connect hotspots that share the same severity (critical/high only for visual clarity)
  const highSeverity = hotspots.filter((h) => h.severity === 'critical' || h.severity === 'high');

  for (let i = 0; i < highSeverity.length; i++) {
    for (let j = i + 1; j < highSeverity.length; j++) {
      const from = highSeverity[i];
      const to = highSeverity[j];
      if (!from || !to) continue;

      // Connect if same severity or same category
      if (from.severity === to.severity || from.category === to.category) {
        arcs.push({
          id: `arc-${from.id}-${to.id}`,
          fromLat: from.lat,
          fromLon: from.lon,
          toLat: to.lat,
          toLon: to.lon,
          color: ARC_COLORS[from.severity] ?? '#00ff41',
          label: `${from.name} ↔ ${to.name}`,
        });
      }
    }
  }

  // Also add some key strategic arcs (e.g., US-China tech war connects Silicon Valley to Taiwan)
  const taiwanHotspot = hotspots.find((h) => h.id === 'taiwan-strait');
  const usChinaTech = hotspots.find((h) => h.id === 'us-china-tech');
  if (taiwanHotspot && usChinaTech) {
    const existingArc = arcs.find(
      (a) =>
        a.id === `arc-${usChinaTech.id}-${taiwanHotspot.id}` ||
        a.id === `arc-${taiwanHotspot.id}-${usChinaTech.id}`,
    );
    if (!existingArc) {
      arcs.push({
        id: 'arc-tech-semiconductor',
        fromLat: usChinaTech.lat,
        fromLon: usChinaTech.lon,
        toLat: taiwanHotspot.lat,
        toLon: taiwanHotspot.lon,
        color: '#ff4444',
        label: 'Semiconductor Supply Chain',
      });
    }
  }

  // Horn of Africa ↔ Middle East (shipping/energy corridor)
  const horn = hotspots.find((h) => h.id === 'horn-of-africa');
  const middleEast = hotspots.find((h) => h.id === 'middle-east');
  if (horn && middleEast) {
    const existingArc = arcs.find(
      (a) =>
        a.id === `arc-${horn.id}-${middleEast.id}` || a.id === `arc-${middleEast.id}-${horn.id}`,
    );
    if (!existingArc) {
      arcs.push({
        id: 'arc-shipping-energy',
        fromLat: horn.lat,
        fromLon: horn.lon,
        toLat: middleEast.lat,
        toLon: middleEast.lon,
        color: '#ff0040',
        label: 'Red Sea Shipping Corridor',
      });
    }
  }

  return arcs;
}

/**
 * Calculate aggregate threat level from hotspots (0-1 scale).
 */
function calculateThreatLevel(hotspots: Hotspot[]): number {
  if (hotspots.length === 0) return 0.3;

  const total = hotspots.reduce((sum, h) => {
    return sum + (SEVERITY_WEIGHT[h.severity] ?? 0);
  }, 0);

  // Normalize to 0-1 range
  return Math.min(1, total / hotspots.length);
}

/**
 * Hook that loads globe data (hotspots, markers, arcs) into the globe store.
 * Fetches hotspots.json on mount and populates the store.
 */
export function useGlobeData() {
  const setHotspots = useGlobeStore((s) => s.setHotspots);
  const setMarkers = useGlobeStore((s) => s.setMarkers);
  const setArcs = useGlobeStore((s) => s.setArcs);
  const setThreatLevel = useGlobeStore((s) => s.setThreatLevel);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    async function loadGlobeData() {
      try {
        // Load hotspots from static JSON
        const res = await fetch('/data/hotspots.json');
        if (!res.ok) throw new Error(`Failed to load hotspots: ${res.status}`);
        const hotspots: Hotspot[] = await res.json();

        // Populate globe store
        setHotspots(hotspots);
        setMarkers(hotspotsToMarkers(hotspots));
        setArcs(generateArcs(hotspots));
        setThreatLevel(calculateThreatLevel(hotspots));
      } catch (err) {
        console.error('[GlobeData] Failed to load hotspots:', err);
      }
    }

    loadGlobeData();
  }, [setHotspots, setMarkers, setArcs, setThreatLevel]);
}

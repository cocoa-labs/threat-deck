import { describe, expect, it } from 'vitest';
import type { CyberGlobeMarker, GlobeMarker } from '@/lib/types';
import {
  buildLayerStats,
  cyberLayerForCategory,
  isCyberMarker,
  markerVisibleForActiveLayers,
} from './cyber-markers';

const baseCyberMarker: CyberGlobeMarker = {
  id: 'cyber-1',
  lat: 37.77,
  lon: -122.42,
  severity: 'critical',
  category: 'cve_critical',
  label: 'Critical CVE',
  count: 1,
  source: 'osint',
  cyberCategory: 'cve',
  streamSource: 'aegis_db',
  cveId: 'CVE-2026-0001',
  cvssScore: 9.8,
};

const legacyMarker: GlobeMarker = {
  id: 'legacy-1',
  lat: 0,
  lon: 0,
  severity: 'medium',
  category: 'strategic',
  label: 'Legacy hotspot',
  count: 1,
  source: 'osint',
};

describe('cyber marker helpers', () => {
  it('maps cyber categories to their sidebar layer', () => {
    expect(cyberLayerForCategory('cve')).toBe('cyberCVEs');
    expect(cyberLayerForCategory('breach')).toBe('cyberBreaches');
    expect(cyberLayerForCategory('threat_actor')).toBe('cyberThreatActors');
    expect(cyberLayerForCategory('critical_infra')).toBe('cyberCriticalInfra');
  });

  it('detects cyber markers without class instances', () => {
    expect(isCyberMarker(baseCyberMarker)).toBe(true);
    expect(isCyberMarker(legacyMarker)).toBe(false);
    expect(isCyberMarker(null)).toBe(false);
  });

  it('filters only cyber markers by their specific active layer', () => {
    expect(markerVisibleForActiveLayers(baseCyberMarker, new Set(['cyberCVEs']))).toBe(true);
    expect(markerVisibleForActiveLayers(baseCyberMarker, new Set(['cyberBreaches']))).toBe(false);
    expect(markerVisibleForActiveLayers(legacyMarker, new Set())).toBe(true);
  });

  it('builds layer stats with severity, stream, and top event summaries', () => {
    const breach: CyberGlobeMarker = {
      ...baseCyberMarker,
      id: 'cyber-2',
      severity: 'high',
      category: 'data_breach',
      label: 'Breach',
      cyberCategory: 'breach',
      streamSource: 'rss',
    };

    const stats = buildLayerStats(
      [baseCyberMarker, breach, legacyMarker],
      new Set(['markers', 'cyberCVEs']),
    );

    expect(stats.cyberCVEs?.total).toBe(1);
    expect(stats.cyberCVEs?.active).toBe(true);
    expect(stats.cyberCVEs?.bySeverity.critical).toBe(1);
    expect(stats.cyberCVEs?.byStream.aegis_db).toBe(1);
    expect(stats.cyberBreaches?.total).toBe(1);
    expect(stats.cyberBreaches?.active).toBe(false);
    expect(stats.markers?.total).toBe(3);
    expect(stats.markers?.byStream.legacy).toBe(1);
  });
});

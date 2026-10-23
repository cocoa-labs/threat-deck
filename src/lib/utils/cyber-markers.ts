import type {
  CyberCategory,
  CyberGlobeMarker,
  CyberStreamSource,
  GlobeLayer,
  GlobeMarker,
  Severity,
} from '@/lib/types';

export type CyberLayer =
  | 'cyberCVEs'
  | 'cyberBreaches'
  | 'cyberThreatActors'
  | 'cyberAIIncidents'
  | 'cyberCriticalInfra'
  | 'cyberIOCs'
  | 'cyberAISafety';

export const CYBER_CATEGORY_TO_LAYER: Record<CyberCategory, CyberLayer> = {
  cve: 'cyberCVEs',
  breach: 'cyberBreaches',
  threat_actor: 'cyberThreatActors',
  ai_incident: 'cyberAIIncidents',
  ai_safety: 'cyberAISafety',
  ioc: 'cyberIOCs',
  critical_infra: 'cyberCriticalInfra',
};

export const CYBER_LAYER_LABELS: Record<CyberLayer, string> = {
  cyberCVEs: 'CVEs',
  cyberBreaches: 'Breaches',
  cyberThreatActors: 'Threat Actors',
  cyberAIIncidents: 'AI Incidents',
  cyberCriticalInfra: 'Critical Infra',
  cyberIOCs: 'IOCs',
  cyberAISafety: 'AI Safety',
};

export const CYBER_LAYERS: CyberLayer[] = [
  'cyberCVEs',
  'cyberBreaches',
  'cyberThreatActors',
  'cyberAIIncidents',
  'cyberCriticalInfra',
  'cyberIOCs',
  'cyberAISafety',
];

const ALL_STATS_LAYERS: GlobeLayer[] = [
  'markers',
  'threatRings',
  'heatmap',
  'arcs',
  'conflictZones',
  'militaryBases',
  'infrastructure',
  'agentActivity',
  'dayNight',
  ...CYBER_LAYERS,
];

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const STREAMS: Array<CyberStreamSource | 'legacy'> = [
  'aegis_db',
  'rss',
  'seed',
  'agent',
  'store',
  'legacy',
];

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export interface LayerStats {
  layer: GlobeLayer;
  active: boolean;
  total: number;
  bySeverity: Record<Severity, number>;
  byStream: Record<CyberStreamSource | 'legacy', number>;
  topEvents: GlobeMarker[];
}

export type LayerStatsMap = Partial<Record<GlobeLayer, LayerStats>>;

export function cyberLayerForCategory(category: CyberCategory): CyberLayer {
  return CYBER_CATEGORY_TO_LAYER[category];
}

export function isCyberLayer(layer: GlobeLayer): layer is CyberLayer {
  return CYBER_LAYERS.includes(layer as CyberLayer);
}

export function isCyberMarker(marker: GlobeMarker | null | undefined): marker is CyberGlobeMarker {
  return Boolean(marker && (marker as CyberGlobeMarker).cyberCategory);
}

export function markerVisibleForActiveLayers(
  marker: GlobeMarker,
  activeLayers: Set<GlobeLayer>,
): boolean {
  if (!isCyberMarker(marker)) return true;
  return activeLayers.has(cyberLayerForCategory(marker.cyberCategory));
}

export function markerBelongsToLayer(marker: GlobeMarker, layer: GlobeLayer): boolean {
  if (layer === 'markers') return true;
  if (layer === 'heatmap') return true;
  if (layer === 'threatRings') {
    return marker.severity === 'critical' || marker.severity === 'high';
  }
  if (!isCyberLayer(layer)) return false;
  return isCyberMarker(marker) && cyberLayerForCategory(marker.cyberCategory) === layer;
}

export function markersForLayer(markers: GlobeMarker[], layer: GlobeLayer): GlobeMarker[] {
  return markers.filter((marker) => markerBelongsToLayer(marker, layer));
}

export function getMarkerSourceUrl(marker: GlobeMarker): string | undefined {
  if (isCyberMarker(marker)) {
    return marker.referenceUrl ?? marker.nvdUrl ?? marker.mitreUrl ?? marker.url;
  }
  return marker.url;
}

function emptySeverityCounts(): Record<Severity, number> {
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    Severity,
    number
  >;
}

function emptyStreamCounts(): Record<CyberStreamSource | 'legacy', number> {
  return Object.fromEntries(STREAMS.map((stream) => [stream, 0])) as Record<
    CyberStreamSource | 'legacy',
    number
  >;
}

export function sortTopEvents(a: GlobeMarker, b: GlobeMarker): number {
  const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severityDelta !== 0) return severityDelta;
  const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
  const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
  if (aTime !== bTime) return bTime - aTime;
  return a.label.localeCompare(b.label);
}

export function buildLayerStats(
  markers: GlobeMarker[],
  activeLayers: Set<GlobeLayer>,
): LayerStatsMap {
  const stats: LayerStatsMap = {};

  for (const layer of ALL_STATS_LAYERS) {
    stats[layer] = {
      layer,
      active: activeLayers.has(layer),
      total: 0,
      bySeverity: emptySeverityCounts(),
      byStream: emptyStreamCounts(),
      topEvents: [],
    };
  }

  for (const marker of markers) {
    for (const layer of ALL_STATS_LAYERS) {
      if (!markerBelongsToLayer(marker, layer)) continue;
      const layerStats = stats[layer];
      if (!layerStats) continue;
      layerStats.total += 1;
      layerStats.bySeverity[marker.severity] += 1;
      layerStats.byStream[isCyberMarker(marker) ? marker.streamSource : 'legacy'] += 1;
      layerStats.topEvents.push(marker);
    }
  }

  for (const layerStats of Object.values(stats)) {
    if (!layerStats) continue;
    layerStats.topEvents = layerStats.topEvents.sort(sortTopEvents).slice(0, 8);
  }

  return stats;
}

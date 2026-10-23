'use client';

/**
 * use-cyber-geo-data — Composite hook merging three cyber-geo streams into one
 * deduplicated `CyberGlobeMarker[]` for the globe/map.
 *
 *   Stream A (AEGIS DB)   — TanStack Query → /api/data/cyber-geo
 *                            Refetch interval respects `wsConnected`
 *                            (Rule #10: adaptive polling).
 *
 *   Stream B (live RSS)   — Subscribes to data-store.news for cyber categories
 *                            (cyber, ai, security, ai_safety) and geo-tags via
 *                            cyberGeotagText(). Markers are ephemeral; their
 *                            id is `cyber-rss-<newsId>-<n>`.
 *
 *   Stream C (static seed)— One-shot fetch of /data/threat-actor-footprint.json
 *                            and /data/critical-infrastructure-cyber.json on
 *                            mount. Persistent across the session.
 *
 * Returns the merged + deduplicated marker array. Does NOT push to stores —
 * the caller (MapDataProvider) merges with other marker sources before
 * dispatching a single `setMarkers()`.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cyberCategoryFromAiCategory,
  cyberGeotagText,
  intelligenceCategoryFromCyber,
} from '@/lib/mapbox/cyber-geotag';
import { useConnectionStore } from '@/lib/store/connection-store';
import { useDataStore } from '@/lib/store/data-store';
import type {
  Advisory,
  BreachDisclosure,
  CVE,
  CyberCategory,
  CyberGlobeMarker,
  CyberLocationPrecision,
  CyberStreamSource,
  IntelligenceCategory,
  IOC,
  KEV,
  NewsItem,
  Severity,
  ThreatActor,
  ZoomTier,
} from '@/lib/types';
import { greatCircleDistance, seededOffset } from '@/lib/utils/geo';

const CYBER_NEWS_CATEGORIES = new Set([
  'cyber',
  'cybersecurity',
  'security',
  'infosec',
  'ai',
  'ai_safety',
  'tech',
  'tech_ai',
]);

const PROXIMITY_DEDUPE_KM = 50;
const RSS_MARKER_TTL_SECONDS = 900; // 15 min

// ─── Stream C: static seed loaders ────────────────────────────────────────

interface ThreatActorFeature {
  type: 'Feature';
  properties: {
    actorId: string;
    displayName: string;
    aliases?: string[];
    actorType?: string;
    attributionCountry?: string;
    techniques?: string[];
    targetSectors?: string[];
    targetGeographies?: string[];
    lastActive?: string;
    victimCountEst?: number;
    sophistication?: string;
    mitreGroupId?: string;
    mitreUrl?: string;
    summary?: string;
  };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

interface CriticalInfraFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    category: string;
    operator?: string;
    sector?: string;
    significance?: string;
    description?: string;
    url?: string;
  };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

function threatActorToMarker(feature: ThreatActorFeature): CyberGlobeMarker {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;

  const severity: Severity = p.sophistication === 'expert' ? 'critical' : 'high';

  return {
    id: `cyber-seed-actor-${p.actorId}`,
    lat,
    lon,
    severity,
    category: 'apt_activity',
    label: p.displayName,
    count: 1,
    source: 'osint',
    description: p.summary,
    timestamp: p.lastActive,
    zoomTier: 'country',
    cyberCategory: 'threat_actor',
    streamSource: 'seed' satisfies CyberStreamSource,
    locationPrecision: 'country',
    locationConfidence: 0.8,
    threatActorId: p.actorId,
    actorAliases: p.aliases,
    techniques: p.techniques,
    lastActiveAt: p.lastActive,
    mitreUrl: p.mitreUrl,
    referenceUrl: p.mitreUrl,
  };
}

function criticalInfraToMarker(feature: CriticalInfraFeature): CyberGlobeMarker {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;

  const severity: Severity = p.significance === 'critical' ? 'high' : 'medium';

  return {
    id: `cyber-seed-infra-${p.id}`,
    lat,
    lon,
    severity,
    category: 'strategic',
    label: p.name,
    count: 1,
    source: 'osint',
    description: p.description,
    zoomTier: 'country',
    cyberCategory: 'critical_infra',
    streamSource: 'seed' satisfies CyberStreamSource,
    locationPrecision: 'facility',
    locationConfidence: 0.95,
    affectedVendors: p.operator ? [p.operator] : undefined,
    referenceUrl: p.url,
  };
}

// ─── Stream B: convert NewsItem → CyberGlobeMarker[] via geotagging ────────

function newsToCyberMarkers(news: NewsItem[]): CyberGlobeMarker[] {
  const out: CyberGlobeMarker[] = [];

  for (const item of news) {
    const cat = (item.category ?? '').toLowerCase();
    const isCyber =
      CYBER_NEWS_CATEGORIES.has(cat) || Boolean(item.aiRelevance && item.aiRelevance > 0.5);
    if (!isCyber) continue;

    const text = `${item.title} ${item.summary ?? ''}`;
    const geoResults = cyberGeotagText(text, 2); // up to 2 markers per item

    for (let idx = 0; idx < geoResults.length; idx += 1) {
      const g = geoResults[idx];
      if (!g) continue;

      // Jitter co-located items slightly so they don't stack identically.
      const offset = seededOffset(`${item.id}-${idx}`, 0.15);

      const cyberCategory: CyberCategory = cyberCategoryFromAiCategory(item.aiCategory, cat);
      const severity: Severity = inferRssSeverity(item, cyberCategory);
      const intelligenceCategory: IntelligenceCategory = intelligenceCategoryFromCyber(
        cyberCategory,
        severity,
      );

      out.push({
        id: `cyber-rss-${item.id}-${idx}`,
        lat: g.lat + offset.dLat,
        lon: g.lon + offset.dLon,
        severity,
        category: intelligenceCategory,
        label: item.title.slice(0, 80),
        count: 1,
        source: 'news',
        description: item.summary,
        timestamp: item.publishedAt,
        url: item.url,
        zoomTier: 'country',
        cyberCategory,
        streamSource: 'rss' satisfies CyberStreamSource,
        locationPrecision: g.confidence >= 0.95 ? 'city' : 'country',
        locationConfidence: g.confidence,
        affectedVendors: [g.name],
        referenceUrl: item.url,
        ttl: RSS_MARKER_TTL_SECONDS,
        rawData: {
          newsSource: item.source,
          imageUrl: item.imageUrl,
          publishedAt: item.publishedAt,
        },
      });
    }
  }

  return out;
}

function inferRssSeverity(item: NewsItem, cyberCategory: CyberCategory): Severity {
  // Title heuristics — keep cheap, runs on every news item
  const title = (item.title ?? '').toLowerCase();
  if (/critical|zero[- ]day|0-day|actively exploited|in the wild|cisa kev/.test(title)) {
    return 'critical';
  }
  if (/high|severe|widespread|ransomware|breach|data exposure|stolen/.test(title)) {
    return 'high';
  }
  if (cyberCategory === 'ai_safety') return 'medium';
  return 'medium';
}

// ─── Stream D: already-loaded store data → CyberGlobeMarker[] ──────────────

function severityFromCve(severity?: string): Severity {
  if (
    severity === 'critical' ||
    severity === 'high' ||
    severity === 'medium' ||
    severity === 'low'
  ) {
    return severity;
  }
  return 'medium';
}

function breachSeverity(records?: number): Severity {
  if (!records) return 'medium';
  if (records >= 10_000_000) return 'critical';
  if (records >= 1_000_000) return 'high';
  return 'medium';
}

function precisionFromConfidence(confidence: number, cyberCategory: CyberCategory) {
  const zoomTier: ZoomTier = confidence >= 0.95 ? 'city' : 'country';
  const locationPrecision: CyberLocationPrecision =
    cyberCategory === 'critical_infra' && confidence >= 0.95
      ? 'facility'
      : confidence >= 0.95
        ? 'city'
        : 'country';
  return { zoomTier, locationPrecision };
}

function fragmentToWords(url?: string): string | undefined {
  if (!url) return undefined;
  const fragment = url.split('#')[1];
  if (!fragment) return undefined;
  return decodeURIComponent(fragment)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function firstGeo(text: string) {
  return cyberGeotagText(text, 1)[0] ?? null;
}

function cvesToCyberMarkers(cves: CVE[], kev: KEV[]): CyberGlobeMarker[] {
  const kevByCve = new Map(kev.map((item) => [item.cveId, item]));
  const seen = new Set<string>();
  const out: CyberGlobeMarker[] = [];

  for (const cve of cves.slice(0, 80)) {
    const kevItem = kevByCve.get(cve.cveId);
    const severity = severityFromCve(cve.severity);
    const searchText = [
      cve.cveId,
      cve.summary,
      cve.tags?.join(' '),
      kevItem?.vendorProject,
      kevItem?.product,
      kevItem?.vulnerabilityName,
    ]
      .filter(Boolean)
      .join(' ');
    const geo = firstGeo(searchText);
    if (!geo) continue;
    const { zoomTier, locationPrecision } = precisionFromConfidence(geo.confidence, 'cve');
    const jitter = seededOffset(`store-cve-${cve.cveId}`, 0.12);
    seen.add(cve.cveId);
    out.push({
      id: `cyber-store-cve-${cve.cveId}`,
      lat: geo.lat + jitter.dLat,
      lon: geo.lon + jitter.dLon,
      severity,
      category: intelligenceCategoryFromCyber('cve', severity),
      label: kevItem?.vulnerabilityName ?? cve.cveId,
      count: 1,
      source: 'osint',
      description: cve.summary,
      timestamp: cve.publishedAt,
      url: cve.nvdSourceUrl,
      zoomTier,
      cyberCategory: 'cve',
      streamSource: 'store',
      locationPrecision,
      locationConfidence: geo.confidence,
      cveId: cve.cveId,
      cvssScore: cve.cvssV4Score ?? cve.cvssV3Score,
      epssScore: cve.epssScore,
      epssPercentile: cve.epssPercentile,
      kevStatus: cve.isKev || kevItem ? 'kev_listed' : 'not_kev',
      affectedVendors: kevItem?.vendorProject ? [kevItem.vendorProject] : undefined,
      affectedProducts: kevItem?.product ? [kevItem.product] : undefined,
      nvdUrl: cve.nvdSourceUrl,
      referenceUrl: cve.nvdSourceUrl,
    });
  }

  for (const kevItem of kev.slice(0, 50)) {
    if (seen.has(kevItem.cveId)) continue;
    const geo = firstGeo(
      `${kevItem.vendorProject ?? ''} ${kevItem.product ?? ''} ${kevItem.vulnerabilityName ?? ''} ${kevItem.shortDescription ?? ''}`,
    );
    if (!geo) continue;
    const { zoomTier, locationPrecision } = precisionFromConfidence(geo.confidence, 'cve');
    const jitter = seededOffset(`store-kev-${kevItem.cveId}`, 0.12);
    out.push({
      id: `cyber-store-kev-${kevItem.cveId}`,
      lat: geo.lat + jitter.dLat,
      lon: geo.lon + jitter.dLon,
      severity: 'critical',
      category: 'cve_critical',
      label: kevItem.vulnerabilityName ?? kevItem.cveId,
      count: 1,
      source: 'osint',
      description: kevItem.shortDescription,
      timestamp: kevItem.addedToKevAt,
      zoomTier,
      cyberCategory: 'cve',
      streamSource: 'store',
      locationPrecision,
      locationConfidence: geo.confidence,
      cveId: kevItem.cveId,
      kevStatus: 'kev_listed',
      affectedVendors: kevItem.vendorProject ? [kevItem.vendorProject] : undefined,
      affectedProducts: kevItem.product ? [kevItem.product] : undefined,
    });
  }

  return out;
}

function breachesToCyberMarkers(breaches: BreachDisclosure[]): CyberGlobeMarker[] {
  const out: CyberGlobeMarker[] = [];
  for (const breach of breaches.slice(0, 80)) {
    const orgName = fragmentToWords(breach.sourceUrl);
    const geo = firstGeo(`${orgName ?? ''} ${breach.notes ?? ''} ${breach.breachType ?? ''}`);
    if (!geo) continue;
    const severity = breachSeverity(breach.recordsCompromised);
    const { zoomTier, locationPrecision } = precisionFromConfidence(geo.confidence, 'breach');
    const jitter = seededOffset(`store-breach-${breach.id}`, 0.18);
    out.push({
      id: `cyber-store-breach-${breach.id}`,
      lat: geo.lat + jitter.dLat,
      lon: geo.lon + jitter.dLon,
      severity,
      category: 'data_breach',
      label: orgName ? `${orgName} breach` : `Breach disclosure ${breach.id}`,
      count: 1,
      source: 'osint',
      description: breach.notes,
      timestamp: breach.disclosedAt,
      url: breach.sourceUrl,
      zoomTier,
      cyberCategory: 'breach',
      streamSource: 'store',
      locationPrecision,
      locationConfidence: geo.confidence,
      breachId: String(breach.id),
      victimOrg: orgName,
      recordsCompromised: breach.recordsCompromised,
      disclosedAt: breach.disclosedAt,
      referenceUrl: breach.sourceUrl,
    });
  }
  return out;
}

function actorsToCyberMarkers(actors: ThreatActor[]): CyberGlobeMarker[] {
  const out: CyberGlobeMarker[] = [];
  for (const actor of actors.slice(0, 80)) {
    const geo = firstGeo(
      `${actor.displayName} ${actor.aliases?.join(' ') ?? ''} ${actor.attributionCountry ?? ''} ${actor.summary ?? ''}`,
    );
    if (!geo) continue;
    const severity: Severity = actor.sophistication === 'expert' ? 'critical' : 'high';
    const { zoomTier, locationPrecision } = precisionFromConfidence(geo.confidence, 'threat_actor');
    const jitter = seededOffset(`store-actor-${actor.actorId}`, 0.18);
    out.push({
      id: `cyber-store-actor-${actor.actorId}`,
      lat: geo.lat + jitter.dLat,
      lon: geo.lon + jitter.dLon,
      severity,
      category: 'apt_activity',
      label: actor.displayName,
      count: 1,
      source: 'osint',
      description: actor.summary,
      timestamp: actor.lastActiveAt,
      zoomTier,
      cyberCategory: 'threat_actor',
      streamSource: 'store',
      locationPrecision,
      locationConfidence: geo.confidence,
      threatActorId: actor.actorId,
      actorAliases: actor.aliases,
      lastActiveAt: actor.lastActiveAt,
      mitreUrl: actor.mitreGroupId
        ? `https://attack.mitre.org/groups/${actor.mitreGroupId}/`
        : actor.references?.[0],
      referenceUrl: actor.references?.[0],
    });
  }
  return out;
}

function advisoriesToCyberMarkers(advisories: Advisory[]): CyberGlobeMarker[] {
  const out: CyberGlobeMarker[] = [];
  for (const advisory of advisories.slice(0, 60)) {
    const geo = firstGeo(
      `${advisory.title ?? ''} ${advisory.summary ?? ''} ${advisory.affectedProducts?.join(' ') ?? ''} ${advisory.issuerGeography ?? ''}`,
    );
    if (!geo) continue;
    const severity = severityFromCve(advisory.severity);
    const { zoomTier, locationPrecision } = precisionFromConfidence(geo.confidence, 'cve');
    const id = advisory.advisoryId ?? String(advisory.id);
    const jitter = seededOffset(`store-advisory-${id}`, 0.16);
    out.push({
      id: `cyber-store-advisory-${id}`,
      lat: geo.lat + jitter.dLat,
      lon: geo.lon + jitter.dLon,
      severity,
      category: intelligenceCategoryFromCyber('cve', severity),
      label: advisory.title ?? `Advisory ${id}`,
      count: 1,
      source: 'osint',
      description: advisory.summary,
      timestamp: advisory.publishedAt,
      url: advisory.advisoryUrl,
      zoomTier,
      cyberCategory: 'cve',
      streamSource: 'store',
      locationPrecision,
      locationConfidence: geo.confidence,
      cveId: advisory.affectedCves?.[0],
      affectedProducts: advisory.affectedProducts,
      referenceUrl: advisory.advisoryUrl,
    });
  }
  return out;
}

function iocsToCyberMarkers(iocs: IOC[]): CyberGlobeMarker[] {
  const out: CyberGlobeMarker[] = [];
  for (const ioc of iocs.slice(0, 40)) {
    const geo = firstGeo(
      `${ioc.tags?.join(' ') ?? ''} ${ioc.source ?? ''} ${ioc.relatedActorId ?? ''}`,
    );
    if (!geo || geo.confidence < 0.85) continue;
    const { zoomTier, locationPrecision } = precisionFromConfidence(geo.confidence, 'ioc');
    const jitter = seededOffset(`store-ioc-${ioc.value}`, 0.12);
    out.push({
      id: `cyber-store-ioc-${ioc.iocType}-${ioc.value}`,
      lat: geo.lat + jitter.dLat,
      lon: geo.lon + jitter.dLon,
      severity: ioc.confidence && ioc.confidence > 0.8 ? 'high' : 'medium',
      category: 'apt_activity',
      label: `${ioc.iocType.toUpperCase()} ${ioc.value.slice(0, 16)}`,
      count: 1,
      source: 'osint',
      description: ioc.tags?.join(', '),
      timestamp: ioc.lastSeen ?? ioc.firstSeen,
      zoomTier,
      cyberCategory: 'ioc',
      streamSource: 'store',
      locationPrecision,
      locationConfidence: geo.confidence,
      iocType: ioc.iocType,
      iocValue: ioc.value,
      cveId: ioc.relatedCveId,
      threatActorId: ioc.relatedActorId,
    });
  }
  return out;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface UseCyberGeoDataResult {
  markers: CyberGlobeMarker[];
  loading: boolean;
  error: Error | null;
  /** Counts per stream — useful for debugging the empty-globe failure mode. */
  counts: { db: number; rss: number; store: number; seed: number; total: number };
}

export function useCyberGeoData(opts?: {
  severity?: Severity;
  eventType?: 'attack' | 'disclosure' | 'takedown' | 'c2_observed';
  limit?: number;
}): UseCyberGeoDataResult {
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const news = useDataStore((s) => s.news);
  const cves = useDataStore((s) => s.cves);
  const kev = useDataStore((s) => s.kev);
  const iocs = useDataStore((s) => s.iocs);
  const breaches = useDataStore((s) => s.breaches);
  const advisories = useDataStore((s) => s.advisories);
  const threatActors = useDataStore((s) => s.threatActors);

  // Stream A — TanStack Query against /api/data/cyber-geo
  const queryString = new URLSearchParams();
  if (opts?.severity) queryString.set('severity', opts.severity);
  if (opts?.eventType) queryString.set('event_type', opts.eventType);
  if (opts?.limit) queryString.set('limit', String(opts.limit));

  const dbQuery = useQuery({
    queryKey: ['cyber-geo', opts?.severity ?? '', opts?.eventType ?? '', opts?.limit ?? 0],
    queryFn: async (): Promise<CyberGlobeMarker[]> => {
      const res = await fetch(
        `/api/data/cyber-geo${queryString.toString() ? `?${queryString.toString()}` : ''}`,
      );
      if (!res.ok) throw new Error(`cyber-geo: ${res.status}`);
      const json = (await res.json()) as { data: CyberGlobeMarker[] };
      return json.data ?? [];
    },
    // Slow refetch when WS connected (server pushes), faster when REST-only.
    refetchInterval: wsConnected ? 600_000 : 120_000,
    staleTime: 60_000,
    // Empty array on error so the globe degrades gracefully.
    placeholderData: [],
  });

  // Stream B — derive from data-store.news (cyber categories)
  const allNews = useMemo(() => Object.values(news).flat() as NewsItem[], [news]);
  const rssMarkers = useMemo(() => newsToCyberMarkers(allNews), [allNews]);
  const storeMarkers = useMemo(
    () => [
      ...cvesToCyberMarkers(cves, kev),
      ...breachesToCyberMarkers(breaches),
      ...actorsToCyberMarkers(threatActors),
      ...advisoriesToCyberMarkers(advisories),
      ...iocsToCyberMarkers(iocs),
    ],
    [cves, kev, breaches, threatActors, advisories, iocs],
  );

  // Stream C — one-shot static seed fetch
  const [seedMarkers, setSeedMarkers] = useState<CyberGlobeMarker[]>([]);
  const seedLoadedRef = useRef(false);

  useEffect(() => {
    if (seedLoadedRef.current) return;
    seedLoadedRef.current = true;

    async function loadSeeds() {
      const out: CyberGlobeMarker[] = [];
      try {
        const [actorsRes, infraRes] = await Promise.all([
          fetch('/data/threat-actor-footprint.json'),
          fetch('/data/critical-infrastructure-cyber.json'),
        ]);

        if (actorsRes.ok) {
          const actorsJson = (await actorsRes.json()) as { features: ThreatActorFeature[] };
          for (const f of actorsJson.features) {
            try {
              out.push(threatActorToMarker(f));
            } catch (err) {
              console.warn('[use-cyber-geo-data] skipped threat actor feature:', err);
            }
          }
        }

        if (infraRes.ok) {
          const infraJson = (await infraRes.json()) as { features: CriticalInfraFeature[] };
          for (const f of infraJson.features) {
            try {
              out.push(criticalInfraToMarker(f));
            } catch (err) {
              console.warn('[use-cyber-geo-data] skipped infra feature:', err);
            }
          }
        }
      } catch (err) {
        console.error('[use-cyber-geo-data] seed load failed:', err);
      }
      setSeedMarkers(out);
    }

    loadSeeds();
  }, []);

  // ─── Merge + dedupe ──────────────────────────────────────────────────────
  const merged = useMemo(() => {
    const dbMarkers = dbQuery.data ?? [];
    const all: CyberGlobeMarker[] = [];

    // Priority order: db (most specific) → rss (recent) → store → seed (baseline)
    const addIfNotTooClose = (m: CyberGlobeMarker) => {
      // Same-category dedupe — seeds and live data can coexist if categories differ
      const tooClose = all.some(
        (existing) =>
          existing.cyberCategory === m.cyberCategory &&
          greatCircleDistance(existing.lat, existing.lon, m.lat, m.lon) < PROXIMITY_DEDUPE_KM,
      );
      if (!tooClose) all.push(m);
    };

    for (const m of dbMarkers) addIfNotTooClose(m);
    for (const m of rssMarkers) addIfNotTooClose(m);
    for (const m of storeMarkers) addIfNotTooClose(m);
    for (const m of seedMarkers) addIfNotTooClose(m);

    return all;
  }, [dbQuery.data, rssMarkers, storeMarkers, seedMarkers]);

  return {
    markers: merged,
    loading: dbQuery.isLoading,
    error: dbQuery.error instanceof Error ? dbQuery.error : null,
    counts: {
      db: (dbQuery.data ?? []).length,
      rss: rssMarkers.length,
      store: storeMarkers.length,
      seed: seedMarkers.length,
      total: merged.length,
    },
  };
}

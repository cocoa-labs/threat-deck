'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useCyberGeoData } from '@/lib/hooks/use-cyber-geo-data';
import { lookupCongressMemberState } from '@/lib/mapbox/congress-members';
import { lookupContractorCoords } from '@/lib/mapbox/contractors';
import { lookupExchangeCoords } from '@/lib/mapbox/exchanges';
import {
  assignZoomTier,
  lookupAgencyCoords,
  lookupCryptoHubCoords,
  lookupStateCoords,
} from '@/lib/mapbox/geo-enrich';
import { geotagNewsItemMulti, inferNewsSeverity, mapNewsCategory } from '@/lib/mapbox/geotag';
import { useDataStore } from '@/lib/store/data-store';
import { useGlobeStore } from '@/lib/store/globe-store';
import { useMapStore } from '@/lib/store/map-store';
import type {
  CongressTrade,
  GlobeArc,
  GlobeMarker,
  GovernmentContract,
  Hotspot,
  NewsItem,
  WhaleTransaction,
} from '@/lib/types';
import { greatCircleDistance, seededOffset } from '@/lib/utils/geo';

// ─── Severity numeric weights ───
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  info: 0.1,
};

const ARC_COLORS: Record<string, string> = {
  critical: '#ff0040',
  high: '#ff4444',
  medium: '#ffaa00',
  low: '#00ff41',
  info: '#666666',
};

const PROXIMITY_THRESHOLD_KM = 50;

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
    description: h.description,
    url: h.url,
    zoomTier: 'global',
  }));
}

function generateArcs(hotspots: Hotspot[]): GlobeArc[] {
  const arcs: GlobeArc[] = [];
  const highSeverity = hotspots.filter((h) => h.severity === 'critical' || h.severity === 'high');

  for (let i = 0; i < highSeverity.length; i++) {
    for (let j = i + 1; j < highSeverity.length; j++) {
      const from = highSeverity[i];
      const to = highSeverity[j];
      if (!from || !to) continue;
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

  const taiwanHotspot = hotspots.find((h) => h.id === 'taiwan-strait');
  const usChinaTech = hotspots.find((h) => h.id === 'us-china-tech');
  if (taiwanHotspot && usChinaTech) {
    const exists = arcs.find(
      (a) =>
        a.id === `arc-${usChinaTech.id}-${taiwanHotspot.id}` ||
        a.id === `arc-${taiwanHotspot.id}-${usChinaTech.id}`,
    );
    if (!exists) {
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

  const horn = hotspots.find((h) => h.id === 'horn-of-africa');
  const middleEast = hotspots.find((h) => h.id === 'middle-east');
  if (horn && middleEast) {
    const exists = arcs.find(
      (a) =>
        a.id === `arc-${horn.id}-${middleEast.id}` || a.id === `arc-${middleEast.id}-${horn.id}`,
    );
    if (!exists) {
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

function calculateThreatLevel(hotspots: Hotspot[]): number {
  if (hotspots.length === 0) return 0.3;
  const total = hotspots.reduce((sum, h) => {
    return sum + (SEVERITY_WEIGHT[h.severity] ?? 0);
  }, 0);
  return Math.min(1, total / hotspots.length);
}

/**
 * Convert news items to geo-tagged markers with zoom tier assignment.
 * Uses multi-location extraction — up to 3 locations per news item.
 */
function newsToMarkers(allNews: NewsItem[], hotspotMarkers: GlobeMarker[]): GlobeMarker[] {
  const newsMarkers: GlobeMarker[] = [];

  for (const item of allNews) {
    const geoResults = geotagNewsItemMulti(item);
    if (geoResults.length === 0) continue;

    const category = mapNewsCategory(item.category);
    const severity = inferNewsSeverity(category);

    for (let idx = 0; idx < geoResults.length; idx++) {
      const geo = geoResults[idx];
      if (!geo) continue;

      // Skip if within 50km of an existing hotspot marker
      const nearHotspot = hotspotMarkers.some(
        (h) => greatCircleDistance(geo.lat, geo.lon, h.lat, h.lon) < PROXIMITY_THRESHOLD_KM,
      );
      if (nearHotspot) continue;

      // Proximity dedup against already-created news markers
      const nearby = newsMarkers.find(
        (m) => greatCircleDistance(geo.lat, geo.lon, m.lat, m.lon) < PROXIMITY_THRESHOLD_KM,
      );
      if (nearby) {
        nearby.count += 1;
        continue;
      }

      const isPrimary = idx === 0;
      const jitter = seededOffset(`${item.id}-${geo.name}`, 0.5);
      newsMarkers.push({
        id: `news-${item.id}${isPrimary ? '' : `-${geo.name}`}`,
        lat: geo.lat + jitter.dLat,
        lon: geo.lon + jitter.dLon,
        severity,
        category,
        label: isPrimary ? item.title.slice(0, 60) : `${item.title.slice(0, 40)} (${geo.name})`,
        count: 1,
        source: 'news',
        description: item.summary,
        timestamp: item.publishedAt,
        url: item.url,
        zoomTier: isPrimary ? assignZoomTier('news', severity, geo.confidence, false) : 'country',
        rawData: {
          publishedAt: item.publishedAt,
          newsSource: item.source,
          imageUrl: item.imageUrl,
        },
      });
    }
  }

  return newsMarkers;
}

/**
 * Convert congress trades to geo-tagged markers by member's home state.
 */
function congressToMarkers(trades: CongressTrade[]): GlobeMarker[] {
  const markers: GlobeMarker[] = [];
  const seenMembers = new Set<string>();

  for (const trade of trades) {
    // Deduplicate by member to avoid stacking
    if (seenMembers.has(trade.member)) continue;
    seenMembers.add(trade.member);

    // Resolve member → home state → coords, fallback to DC
    const state = lookupCongressMemberState(trade.member);
    const coords = (state ? lookupStateCoords(state) : null) ??
      lookupStateCoords('washington') ?? { lat: 38.9, lon: -77.0 };

    const jitter = seededOffset(trade.id, 1.5);
    markers.push({
      id: `congress-${trade.id}`,
      lat: coords.lat + jitter.dLat,
      lon: coords.lon + jitter.dLon,
      severity: 'medium',
      category: 'policy',
      label: `${trade.member} (${trade.party}) ${trade.transactionType} ${trade.symbol}`,
      count: 1,
      source: 'congress',
      description: `${trade.transactionType} of ${trade.symbol} — ${trade.amount}`,
      timestamp: trade.filedDate,
      url: trade.url,
      zoomTier: 'country',
      rawData: {
        member: trade.member,
        party: trade.party,
        chamber: trade.chamber,
        tradeSymbol: trade.symbol,
        tradeAmount: trade.amount,
        transactionType: trade.transactionType,
      },
    });
  }

  return markers;
}

/**
 * Convert government contracts to geo-tagged markers.
 * Resolution: contractor HQ → agency HQ → fallback.
 */
function contractsToMarkers(contracts: GovernmentContract[]): GlobeMarker[] {
  const markers: GlobeMarker[] = [];

  for (const contract of contracts) {
    // Try contractor HQ first, then agency HQ fallback
    const coords =
      lookupContractorCoords(contract.contractor) ?? lookupAgencyCoords(contract.agency);
    if (!coords) continue;

    const jitter = seededOffset(contract.id, 0.5);
    markers.push({
      id: `contract-${contract.id}`,
      lat: coords.lat + jitter.dLat,
      lon: coords.lon + jitter.dLon,
      severity: contract.amount > 10_000_000 ? 'high' : 'medium',
      category: 'policy',
      label: `${contract.agency}: ${contract.description.slice(0, 50)}`,
      count: 1,
      source: 'contracts',
      description: `${contract.contractor} — $${(contract.amount / 1_000_000).toFixed(1)}M`,
      timestamp: contract.awardDate,
      url: contract.url,
      zoomTier: 'country',
      rawData: {
        contractor: contract.contractor,
        agency: contract.agency,
        contractAmount: contract.amount,
      },
    });
  }

  return markers;
}

/**
 * Convert whale transactions to geo-tagged markers.
 * Resolution: exchange name in from/to → crypto hub → fallback.
 */
function whalesToMarkers(whales: WhaleTransaction[]): GlobeMarker[] {
  const markers: GlobeMarker[] = [];

  for (const whale of whales) {
    // Try exchange lookup from from/to addresses first
    const coords =
      lookupExchangeCoords(whale.from) ??
      lookupExchangeCoords(whale.to) ??
      lookupCryptoHubCoords(whale.symbol) ??
      lookupCryptoHubCoords(whale.blockchain);
    if (!coords) continue;

    const jitter = seededOffset(whale.id, 0.5);
    markers.push({
      id: `whale-${whale.id}`,
      lat: coords.lat + jitter.dLat,
      lon: coords.lon + jitter.dLon,
      severity: whale.amountUsd > 10_000_000 ? 'high' : 'medium',
      category: 'alternative',
      label: `${whale.symbol} whale: $${(whale.amountUsd / 1_000_000).toFixed(1)}M`,
      count: 1,
      source: 'whales',
      description: `${whale.amount.toLocaleString()} ${whale.symbol} moved`,
      timestamp: whale.timestamp,
      url: whale.url,
      zoomTier: 'country',
      rawData: {
        blockchain: whale.blockchain,
        txSymbol: whale.symbol,
        amountUsd: whale.amountUsd,
        fromAddress: whale.from,
        toAddress: whale.to,
        txHash: whale.hash,
      },
    });
  }

  return markers;
}

/**
 * Loads hotspots into BOTH map-store and globe-store.
 * Subscribes to live news + alternative data and creates dynamic markers.
 */
export function MapDataProvider() {
  // Globe store setters
  const setGlobeHotspots = useGlobeStore((s) => s.setHotspots);
  const setGlobeMarkers = useGlobeStore((s) => s.setMarkers);
  const setGlobeArcs = useGlobeStore((s) => s.setArcs);
  const setGlobeThreatLevel = useGlobeStore((s) => s.setThreatLevel);

  // Map store setters
  const setMapHotspots = useMapStore((s) => s.setHotspots);
  const setMapMarkers = useMapStore((s) => s.setMarkers);
  const setMapArcs = useMapStore((s) => s.setArcs);
  const setMapThreatLevel = useMapStore((s) => s.setThreatLevel);

  // Data from data store
  const newsMap = useDataStore((s) => s.news);
  const congressTrades = useDataStore((s) => s.congressTrades);
  const governmentContracts = useDataStore((s) => s.governmentContracts);
  const whaleTransactions = useDataStore((s) => s.whaleTransactions);

  // Refs for state across effects
  const loadedRef = useRef(false);
  const hotspotMarkersRef = useRef<GlobeMarker[]>([]);
  const seenNewsIdsRef = useRef<Set<string>>(new Set());

  // Load hotspots once
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    async function loadData() {
      try {
        const res = await fetch('/data/hotspots.json');
        if (!res.ok) throw new Error(`Failed to load hotspots: ${res.status}`);
        const hotspots: Hotspot[] = await res.json();

        const markers = hotspotsToMarkers(hotspots);
        const arcs = generateArcs(hotspots);
        const threatLevel = calculateThreatLevel(hotspots);

        hotspotMarkersRef.current = markers;

        setGlobeHotspots(hotspots);
        setGlobeMarkers(markers);
        setGlobeArcs(arcs);
        setGlobeThreatLevel(threatLevel);

        setMapHotspots(hotspots);
        setMapMarkers(markers);
        setMapArcs(arcs);
        setMapThreatLevel(threatLevel);
      } catch (err) {
        console.error('[MapDataProvider] Failed to load hotspots:', err);
      }
    }

    loadData();
  }, [
    setGlobeHotspots,
    setGlobeMarkers,
    setGlobeArcs,
    setGlobeThreatLevel,
    setMapHotspots,
    setMapMarkers,
    setMapArcs,
    setMapThreatLevel,
  ]);

  // Memoize individual marker conversions — each only recomputes when its data changes
  const allNews = useMemo(() => Object.values(newsMap).flat(), [newsMap]);

  const newNewsMarkers = useMemo(
    () => newsToMarkers(allNews, hotspotMarkersRef.current),
    [allNews],
  );

  const congressMarkers = useMemo(() => congressToMarkers(congressTrades), [congressTrades]);

  const contractMarkers = useMemo(
    () => contractsToMarkers(governmentContracts),
    [governmentContracts],
  );

  const whaleMarkers = useMemo(() => whalesToMarkers(whaleTransactions), [whaleTransactions]);

  // Cyber-geo stream: AEGIS DB + live RSS cyber-geotag + static seed,
  // merged + deduped inside the hook. Pulled here so the unified merge
  // below sees a single set rather than three.
  const { markers: cyberMarkers } = useCyberGeoData();

  // Merge and push to stores when any marker set changes.
  // The cyber-geo stream is allowed to render even when hotspots failed to
  // load — without this guard the dashboard would stay empty if /data/hotspots.json
  // 404s, even though AEGIS DB and the cyber seeds are available.
  useEffect(() => {
    const hotspotMarkers = hotspotMarkersRef.current;

    if (
      hotspotMarkers.length === 0 &&
      newNewsMarkers.length === 0 &&
      congressMarkers.length === 0 &&
      contractMarkers.length === 0 &&
      whaleMarkers.length === 0 &&
      cyberMarkers.length === 0
    ) {
      return;
    }

    const mergedMarkers = [
      ...hotspotMarkers,
      ...newNewsMarkers,
      ...congressMarkers,
      ...contractMarkers,
      ...whaleMarkers,
      ...cyberMarkers,
    ];
    setMapMarkers(mergedMarkers);
    setGlobeMarkers(mergedMarkers);
  }, [
    newNewsMarkers,
    congressMarkers,
    contractMarkers,
    whaleMarkers,
    cyberMarkers,
    setMapMarkers,
    setGlobeMarkers,
  ]);

  // Track seen news ids for marker dedup.
  //
  // The breaking-alert watcher that used to live here is gone. It fired the
  // hero's red flashing banner on any news item whose category mapped to
  // `conflict`/`instability` — a geopolitical-fork leftover. Of the 7 RSS
  // categories only `defense` maps to `conflict` and `cyber`/`ai` both map to
  // `technology`, so in a cybersecurity product the loudest surface in the app
  // could only ever be tripped by a defense-industry story. It also discarded
  // the NewsItem's title/summary/url one line before raising the banner, which
  // is why the alert had nothing to click and nothing to read.
  //
  // The overlay is now driven by `use-breaking-alerts`, off the real AEGIS
  // alert spine, and it carries a headline and a source link.
  useEffect(() => {
    for (const item of allNews) {
      seenNewsIdsRef.current.add(item.id);
    }
  }, [allNews]);

  return null;
}

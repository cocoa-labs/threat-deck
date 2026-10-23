'use client';

import { useCallback, useRef } from 'react';
import { getMapInstance } from '@/components/map/MapCanvas';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/agent/attachments/validation';
import { validateCitations } from '@/lib/agent/citation-validator';
import { type AgentMode, extractModeMarker, stripAllModeMarkers } from '@/lib/agent/mode-config';
import { buildSessionMediaManifest } from '@/lib/agent/session-media';
import { getRecentCues } from '@/lib/captions/caption-bridge';
import { claimMediaPoll, releaseMediaPoll } from '@/lib/hooks/media-poll-registry';
import { captureViewportSnapshot } from '@/lib/mapbox/viewport-features';
import { sendEmailMe } from '@/lib/outbound/send-email-me';
import { useAgentStore } from '@/lib/store/agent-store';
import { useDataStore } from '@/lib/store/data-store';
import { useMapStore } from '@/lib/store/map-store';
import { usePanelsStore } from '@/lib/store/panels-store';
import { useYouTubeStore } from '@/lib/store/youtube-store';
import type {
  AgentIntelMarker,
  BriefFormat,
  BriefSummary,
  GlobeLayer,
  IntelligenceCategory,
  Severity,
} from '@/lib/types';
import { flyToActor, flyToBreach, flyToCVE } from '@/lib/utils/cyber-fly';
import { greatCircleDistance, severityToHex } from '@/lib/utils/geo';

// ─── TV Context Detection ───

/** Keywords that indicate the user is asking about their active livestream */
const TV_KEYWORDS = [
  // Generic
  'watching',
  'tv',
  'livestream',
  'live stream',
  'broadcast',
  'channel',
  "what's on",
  'whats on',
  'on air',
  'airing',
  // Conversational
  "they're saying",
  'they mentioned',
  'the anchor',
  'the host',
  'who is that',
  'this story',
  'this report',
  'covering right now',
  'talking about',
  'just said',
  'breaking on',
  // Channel names
  'cnbc',
  'bloomberg',
  'sky news',
  'al jazeera',
  'france 24',
  'dw news',
  'ndtv',
  'nhk',
  'nasa tv',
  'cheddar',
  'yahoo finance',
  'fox business',
  'cbs news',
  'reuters',
  'euronews',
  'wion',
  'cna',
  'coindesk',
];

/**
 * Check if a query is TV-related by matching against known keywords.
 * Case-insensitive substring matching.
 */
function isTvRelatedQuery(task: string): boolean {
  const lower = task.toLowerCase();
  return TV_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Geographic Intent Detection ───

/** Location terms for geo-intent detection — any mention triggers map navigation */
const GEO_LOCATION_TERMS = [
  // ─── Countries ───
  'ukraine',
  'russia',
  'china',
  'taiwan',
  'israel',
  'gaza',
  'iran',
  'iraq',
  'syria',
  'korea',
  'japan',
  'india',
  'pakistan',
  'afghanistan',
  'yemen',
  'united kingdom',
  'uk',
  'germany',
  'france',
  'italy',
  'spain',
  'brazil',
  'australia',
  'canada',
  'mexico',
  'saudi arabia',
  'south africa',
  'nigeria',
  'egypt',
  'turkey',
  'philippines',
  // ─── Regions ───
  'europe',
  'asia',
  'africa',
  'middle east',
  'arctic',
  'sahel',
  'balkans',
  'scandinavia',
  'east asia',
  'southeast asia',
  'central asia',
  'south asia',
  'sub-saharan africa',
  'north africa',
  'latin america',
  'central america',
  'caribbean',
  'oceania',
  'levant',
  'caucasus',
  'eastern europe',
  'western europe',
  'central europe',
  // ─── US Cities ───
  'washington',
  'd.c.',
  'dc',
  'new york',
  'nyc',
  'los angeles',
  'l.a.',
  'chicago',
  'chicagoland',
  'miami',
  'atlanta',
  'houston',
  'dallas',
  'seattle',
  'boston',
  'detroit',
  'denver',
  'phoenix',
  'san francisco',
  'las vegas',
  'silicon valley',
  'wall street',
  // ─── World Cities ───
  'london',
  'paris',
  'berlin',
  'moscow',
  'beijing',
  'tokyo',
  'hong kong',
  'singapore',
  'sydney',
  'toronto',
  'mexico city',
  'cairo',
  'riyadh',
  'dubai',
  'istanbul',
  'tehran',
  'jerusalem',
  'tel aviv',
  'kyiv',
  'taipei',
  'seoul',
  'pyongyang',
  'mumbai',
  'delhi',
  'munich',
  'rome',
  'amsterdam',
  'zurich',
  'vienna',
  'prague',
  'warsaw',
  'budapest',
  'osaka',
  'shanghai',
  'guangzhou',
  'shenzhen',
  'bangalore',
  'chennai',
  'karachi',
  'kabul',
  'baghdad',
  'damascus',
  'beirut',
  'doha',
  'kuwait city',
  'abu dhabi',
  'davos',
  'addis ababa',
  'hanoi',
  'jakarta',
  'kuala lumpur',
  'lima',
  'bogota',
  'santiago',
  'cape town',
  'casablanca',
  'algiers',
  'tunis',
  'tripoli',
  'khartoum',
  'mogadishu',
  'minsk',
  'tbilisi',
  'baku',
  'yerevan',
  // ─── US Regions ───
  'midwest',
  'southeast',
  'northeast',
  'southwest',
  'pacific northwest',
  'gulf coast',
  'east coast',
  'west coast',
  'rust belt',
  'sun belt',
  // ─── Waterways & Straits ───
  'persian gulf',
  'red sea',
  'suez canal',
  'strait of hormuz',
  'south china sea',
  'strait of malacca',
  'horn of africa',
  'black sea',
  'baltic sea',
  'caspian sea',
  'english channel',
  'panama canal',
  'bosporus',
  'dardanelles',
  'aegean',
  'adriatic',
  // ─── Geographic Features ───
  'alps',
  'french alps',
  'himalayas',
  'mediterranean',
  // ─── US Neighborhoods & Landmarks ───
  'hollywood',
  'manhattan',
  'brooklyn',
  'times square',
  'capitol hill',
  'beverly hills',
  'south beach',
  'downtown miami',
  'midtown',
  'harlem',
  'the bronx',
  'queens',
  'west loop',
  'gold coast',
  'waikiki',
  'pentagon',
  'the pentagon',
  // ─── World Neighborhoods & Landmarks ───
  'city of london',
  'westminster',
  'shibuya',
  'shinjuku',
  'champs-elysees',
  'kremlin',
  'west bank',
  'crimea',
  'donbas',
  'strait of taiwan',
];

/**
 * Detect geographic intent — user mentions a known location.
 * Location-first: any mention of a recognized location triggers map navigation.
 * Strips <context>JSON</context> blocks to prevent false positives from panel click data.
 */
function isGeographicQuery(task: string): boolean {
  const lower = task.toLowerCase();
  // Strip <context>JSON</context> blocks to prevent false positives from structured data
  const cleaned = lower.replace(/<context>[\s\S]*?<\/context>/g, '');
  return GEO_LOCATION_TERMS.some((loc) => cleaned.includes(loc));
}

// ─── YouTube Search Intent Detection ───

/** Keywords indicating YouTube search intent (not livestream channel switching) */
const YOUTUBE_SEARCH_PHRASES = [
  'find me a video',
  'find a video',
  'find videos',
  'search youtube',
  'search for a video',
  'youtube video',
  'watch a video about',
  'play a video about',
  'show me a video',
  'look up a video',
  'find something about',
  'any good videos',
];

/**
 * Check if a query is a YouTube search request.
 * YouTube search queries should NOT trigger the TV context path.
 */
function isYouTubeSearchQuery(task: string): boolean {
  const lower = task.toLowerCase();
  return YOUTUBE_SEARCH_PHRASES.some((p) => lower.includes(p));
}

// ─── Channel Switch Detection ───

/** Phrases that indicate the user wants to SWITCH channels, not ask about what's on */
const CHANNEL_SWITCH_PHRASES = [
  'switch to',
  'switch the channel',
  'change to',
  'change the channel',
  'change channel',
  'put on',
  'tune to',
  'turn on',
  'turn to',
  'go to',
  'play ',
  'watch ',
  'switch over',
  'flip to',
  'can you switch',
  'can you change',
  'can you put on',
  'can you tune',
  'switch livestream',
  'switch live stream',
];

/**
 * Detect channel-switch intent. When the user wants to switch channels,
 * we should NOT set engagementLevel='focused' — that hint discourages
 * the agent from calling tv_switch_channel.
 */
function isChannelSwitchQuery(task: string): boolean {
  const lower = task.toLowerCase();
  return CHANNEL_SWITCH_PHRASES.some((p) => lower.includes(p));
}

/**
 * Read the active livestream channel ID from localStorage.
 * This key is set by LivestreamPanel's useSyncExternalStore.
 */
function getActiveChannelId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      localStorage.getItem('klammer-active-channel') ??
      localStorage.getItem('klammer-livestream-channel') ??
      localStorage.getItem('klammer-livestream2-channel') ??
      null
    );
  } catch {
    return null;
  }
}

// ─── Brief Extraction ───

function extractConfidence(text: string): string | undefined {
  const match =
    text.match(/\bConfidence:\s*(\w+)\s*\((\d+)%\)/i) ??
    text.match(/\bConfidence:\s*(\d+)%/i) ??
    text.match(/\bConfidence:\s*(HIGH|MEDIUM|LOW)/i);
  if (!match) return undefined;
  return match[2] ? `${match[2]}%` : match[1]!;
}

/** Preamble patterns the agent emits before the actual brief content */
const PREAMBLE_RE =
  /^(now i'll|i'll now|let me|here'?s|i've |generating|based on|using the|i will|now let|after |having )/i;

/**
 * Extract the BLUF (Bottom Line Up Front) as the brief headline.
 * Looks for `**BLUF:**` content first, then first `#`-header, then falls back to topic.
 */
function extractHeadline(text: string, fallback: string): string {
  // 1. Try BLUF line — strip the prefix and markdown bold
  const blufMatch = text.match(/\*?\*?BLUF:?\*?\*?\s*(.+)/i);
  if (blufMatch?.[1]) {
    const bluf = blufMatch[1].replace(/\*\*/g, '').trim();
    if (bluf.length > 10) return bluf.length > 180 ? `${bluf.slice(0, 177)}...` : bluf;
  }

  // 2. Try first markdown header that isn't a section label like "## KEY FINDINGS"
  const sectionLabels = new Set([
    'bluf',
    'data summary',
    'key findings',
    'market impact',
    'risk assessment',
    'intelligence brief',
    'summary',
    'overview',
  ]);
  for (const line of text.split('\n')) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch?.[1]) {
      const header = headerMatch[1].replace(/\*\*/g, '').trim();
      if (header.length > 10 && !sectionLabels.has(header.toLowerCase())) {
        return header.length > 180 ? `${header.slice(0, 177)}...` : header;
      }
    }
  }

  // 3. First substantive line that isn't preamble/separator
  for (const line of text.split('\n')) {
    const clean = line
      .replace(/^#+\s*/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (
      clean.length > 15 &&
      clean.length < 200 &&
      !clean.startsWith('---') &&
      !PREAMBLE_RE.test(clean)
    ) {
      return clean;
    }
  }

  return fallback;
}

/**
 * Strip agent preamble from the brief text so stored content starts at the actual brief.
 * Finds the first `---`, `**BLUF`, or `#` header and returns from there.
 */
function stripPreamble(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Brief starts at a horizontal rule, BLUF, or first markdown header
    if (line === '---' || /\*?\*?BLUF/i.test(line) || /^#{1,3}\s+/.test(line)) {
      return lines.slice(i).join('\n');
    }
  }
  // No clear start found — return as-is
  return text;
}

/** Track the highest zoom set during the current agent stream.
 *  Prevents convenience flyTo (place_markers, draw_attention) from
 *  overriding a more zoomed-in view set by authoritative commands. */
let streamMaxZoom = 0;

/** Track whether fly_to was already processed in this stream.
 *  Prevents search_results from overriding a correct fly_to target
 *  with stale proximity-based search coordinates. */
let streamHasFlyTo = false;

/** When true, suppress all map camera movements (flyTo) but allow markers/pulses.
 *  Set when the user right-clicks "Analyze this location" — they are already viewing
 *  the exact location and camera movement would disrupt their view. */
let suppressMapMovement = false;

/** Process map commands returned from agent tool calls */
function handleMapCommand(result: Record<string, unknown>) {
  const store = useMapStore.getState();
  const command = result.__map_command as string;

  switch (command) {
    case 'fly_to': {
      const lat = result.lat as number;
      const lon = result.lon as number;
      const zoom = result.zoom as number | undefined;
      if (!suppressMapMovement) {
        // Explicit "fly there" tool result — lock rotation to Max's target
        // until the user drags or toggles. `place_markers` / `draw_attention`
        // call flyTo without `lock` so their incidental camera moves let
        // rotation resume after markers fade.
        store.flyTo(lat, lon, zoom, { lock: true });
      }
      streamMaxZoom = Math.max(streamMaxZoom, zoom ?? 6);
      streamHasFlyTo = true;
      break;
    }
    case 'highlight_markers': {
      const category = result.category as string | null;
      const ids = result.ids as string[] | undefined;
      if (category) {
        store.setCategoryFilter(new Set([category]));
      } else {
        store.setCategoryFilter(null);
      }
      if (ids && ids.length > 0) {
        store.highlightMarkers(ids);
      }
      break;
    }
    case 'toggle_layer': {
      const layer = result.layer as GlobeLayer;
      const visible = result.visible as boolean | null | undefined;
      if (visible != null) {
        store.setLayerActive(layer, visible);
      } else {
        store.toggleLayer(layer);
      }
      break;
    }
    case 'draw_attention': {
      const lat = result.lat as number;
      const lon = result.lon as number;
      const label = (result.label as string) ?? '';
      const color = (result.color as string) ?? '#ff0040';
      const duration = (result.duration as number) ?? 5;
      // Only fly if we haven't already zoomed in closer
      if (!suppressMapMovement && 6 >= streamMaxZoom) {
        store.flyTo(lat, lon, 6);
        streamMaxZoom = 6;
      }
      // Always add pulse regardless of flyTo
      store.addAttentionPulse({
        id: `attention-${Date.now()}`,
        lat,
        lon,
        label,
        color,
        duration,
        startTime: Date.now(),
      });
      break;
    }
    case 'place_markers': {
      const rawMarkers = result.markers as Array<{
        lat: number;
        lon: number;
        label: string;
        description: string;
        severity: string;
        category: string;
      }>;
      const ttl = (result.ttl as number) ?? 60;
      const { addAgentIntelMarkers } = useDataStore.getState();

      const intelMarkers: AgentIntelMarker[] = rawMarkers.map((m, i) => ({
        id: `agent-intel-${Date.now()}-${i}`,
        lat: m.lat,
        lon: m.lon,
        label: m.label,
        description: m.description,
        severity: m.severity as Severity,
        category: m.category as IntelligenceCategory,
        source: 'agent' as const,
        confidence: 0.8,
        ttl,
        createdAt: Date.now(),
        glowColor: severityToHex(m.severity as Severity),
      }));

      addAgentIntelMarkers(intelMarkers);

      // Fly to centroid of placed markers — only if we haven't already zoomed in closer
      if (intelMarkers.length > 0) {
        const avgLat = intelMarkers.reduce((s, m) => s + m.lat, 0) / intelMarkers.length;
        const avgLon = intelMarkers.reduce((s, m) => s + m.lon, 0) / intelMarkers.length;
        const targetZoom = intelMarkers.length === 1 ? 8 : 5;
        if (!suppressMapMovement && targetZoom >= streamMaxZoom) {
          store.flyTo(avgLat, avgLon, targetZoom);
          streamMaxZoom = targetZoom;
        }
      }
      break;
    }
    case 'search_results': {
      const results = result.results as Array<{
        lat: number;
        lon: number;
        name: string;
        category: string;
      }>;
      if (!results || results.length === 0) break;

      const { addAgentIntelMarkers } = useDataStore.getState();
      const searchMarkers: AgentIntelMarker[] = results.map((r, i) => ({
        id: `search-result-${Date.now()}-${i}`,
        lat: r.lat,
        lon: r.lon,
        label: r.name,
        description: `Search result: ${r.category}`,
        severity: 'info' as Severity,
        category: 'strategic' as IntelligenceCategory,
        source: 'agent' as const,
        confidence: 0.9,
        ttl: 120,
        createdAt: Date.now(),
        glowColor: '#00ff41',
      }));
      addAgentIntelMarkers(searchMarkers);

      // Fly to show results — skip if fly_to already set the correct target
      if (!suppressMapMovement && !streamHasFlyTo) {
        if (results.length === 1) {
          store.flyTo(results[0]!.lat, results[0]!.lon, 15);
          streamMaxZoom = Math.max(streamMaxZoom, 15);
        } else {
          const lats = results.map((r) => r.lat);
          const lons = results.map((r) => r.lon);
          const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
          const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
          store.flyTo(centerLat, centerLon, 14);
          streamMaxZoom = Math.max(streamMaxZoom, 14);
        }
      }
      break;
    }
  }
}

/**
 * Smart routing for agent video commands. When the hero LIVE tab is the
 * active lens (`heroTab === 'live'`), drive the hero LivestreamSurface
 * directly. Otherwise dispatch the legacy panel-targeted events that the
 * grid Livestream / YouTube panels listen for. One canonical "wherever the
 * user is looking" rule.
 */
function isHeroLiveActive(): boolean {
  return useMapStore.getState().heroTab === 'live';
}

/** Process channel commands returned from agent tool calls */
function handleChannelCommand(result: Record<string, unknown>) {
  const command = result.__channel_command as string;
  if (command !== 'switch') return;

  const channelId = result.channelId as string;
  let panel = result.panel as string;

  if (panel === 'auto') {
    const { fullscreenSlot, slotAssignments } = usePanelsStore.getState();
    if (fullscreenSlot) {
      const assignedPanel = slotAssignments[fullscreenSlot];
      if (assignedPanel === 'livestream') {
        panel = 'primary';
      } else if (assignedPanel === 'livestream2') {
        panel = 'secondary';
      } else {
        panel = 'primary';
      }
    } else {
      panel = 'primary';
    }
  }

  const eventName = isHeroLiveActive() ? 'klammer-hero-channel-switch' : 'klammer-channel-switch';
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: { channelId, panel, autoPlay: true },
    }),
  );
}

/** Process YouTube commands returned from agent tool calls */
function handleYouTubeCommand(result: Record<string, unknown>) {
  const command = result.__youtube_command as string;
  const eventName = isHeroLiveActive() ? 'klammer-hero-youtube-play' : 'klammer-youtube-play';

  switch (command) {
    case 'search_results': {
      const autoPlay = result.autoPlay as Record<string, unknown>;
      const alternatives = result.alternatives as Array<Record<string, unknown>>;

      // Dispatch to YouTube store via custom event
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { type: 'search_results', autoPlay, alternatives, query: result.query },
        }),
      );
      break;
    }
    case 'play': {
      const videoId = result.videoId as string;
      const title = result.title as string | null;
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { type: 'play', video: { videoId, title } },
        }),
      );
      break;
    }
    case 'queue': {
      const videos = result.videos as Array<Record<string, unknown>>;
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { type: 'queue', videos, autoPlayFirst: result.autoPlayFirst },
        }),
      );
      break;
    }
  }
}

type GeneratedMediaMarker = {
  __generated_media?: unknown;
  mediaKind?: unknown;
  generatedMediaId?: unknown;
  status?: unknown;
  pollUrl?: unknown;
  blobUrl?: unknown;
  styleTag?: unknown;
  providerJobId?: unknown;
  providerStatus?: unknown;
  errorMessage?: unknown;
};

/**
 * A conversational email the agent QUEUED because its attachment was still
 * rendering (operator-self send). Once every awaited media id resolves to ready,
 * the media poller fires it via /api/outbound/email-me — auto-doing what the
 * manual EMAIL button does. Carried on the `__email_when_ready` tool marker.
 */
type EmailWhenReadyIntent = {
  awaitedMediaIds: string[];
  content: string;
  severity?: string;
  alertEntityKind?: string;
  alertEntityId?: string;
  messageTimestamp: number;
};

/**
 * Process cyber-geo commands returned from AEGIS tool calls. Each command
 * flies the globe/map to a CVE / threat actor / breach if the corresponding
 * marker is loaded. Silently no-op on miss so the command is fail-safe.
 */
function handleCyberGeoCommand(result: Record<string, unknown>) {
  const command = result.__cyber_geo_command as string;
  switch (command) {
    case 'fly_to_actor': {
      const actorId = result.actorId as string | undefined;
      if (actorId) flyToActor(actorId);
      break;
    }
    case 'fly_to_cve': {
      const cveId = result.cveId as string | undefined;
      if (cveId) flyToCVE(cveId);
      break;
    }
    case 'fly_to_breach': {
      const breachId = result.breachId as string | undefined;
      if (breachId) flyToBreach(breachId);
      break;
    }
  }
}

function isGeneratedMediaMarker(value: Record<string, unknown>): value is GeneratedMediaMarker {
  return value.__generated_media === true;
}

type GeneratedMediaStatus = 'pending' | 'ready' | 'failed';

type GeneratedMediaAttachment =
  | {
      mediaKind: 'image';
      generatedMediaId: string;
      blobUrl?: string;
      styleTag?: string;
      status?: GeneratedMediaStatus;
      pollUrl?: string;
      providerJobId?: string;
      providerStatus?: string;
      errorMessage?: string;
      createdAt: number;
    }
  | {
      mediaKind: 'video';
      generatedMediaId: string;
      blobUrl?: string;
      styleTag?: string;
      status?: GeneratedMediaStatus;
      pollUrl?: string;
      providerJobId?: string;
      providerStatus?: string;
      errorMessage?: string;
      createdAt: number;
    };

function attachmentFromMarker(marker: GeneratedMediaMarker): GeneratedMediaAttachment | null {
  if (marker.mediaKind !== 'image' && marker.mediaKind !== 'video') return null;
  if (typeof marker.generatedMediaId !== 'string' || marker.generatedMediaId.length === 0) {
    return null;
  }
  const status: GeneratedMediaStatus | undefined =
    marker.status === 'ready' || marker.status === 'failed' || marker.status === 'pending'
      ? marker.status
      : undefined;
  const blobUrl =
    typeof marker.blobUrl === 'string' && marker.blobUrl.length > 0 ? marker.blobUrl : undefined;
  const base: Omit<GeneratedMediaAttachment, 'mediaKind' | 'blobUrl'> = {
    generatedMediaId: marker.generatedMediaId,
    ...(typeof marker.styleTag === 'string' ? { styleTag: marker.styleTag } : {}),
    ...(status ? { status } : {}),
    ...(typeof marker.pollUrl === 'string' ? { pollUrl: marker.pollUrl } : {}),
    ...(typeof marker.providerJobId === 'string' ? { providerJobId: marker.providerJobId } : {}),
    ...(typeof marker.providerStatus === 'string' ? { providerStatus: marker.providerStatus } : {}),
    ...(typeof marker.errorMessage === 'string' ? { errorMessage: marker.errorMessage } : {}),
    createdAt: Date.now(),
  };
  if (marker.mediaKind === 'image') {
    return {
      mediaKind: 'image',
      ...base,
      ...(blobUrl ? { blobUrl } : {}),
    };
  }
  return {
    mediaKind: 'video',
    ...base,
    ...(blobUrl ? { blobUrl } : {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollGeneratedMediaForMessage(
  messageIndex: number,
  markers: GeneratedMediaMarker[],
  emailIntents: EmailWhenReadyIntent[] = [],
): Promise<void> {
  const pending = markers.filter(
    (marker) =>
      marker.status === 'pending' &&
      typeof marker.pollUrl === 'string' &&
      marker.pollUrl.startsWith('/api/outbound/generated-media/'),
  );
  if (pending.length === 0) return;

  // Shared resolution state so a deferred "email when ready" send (the agent
  // queued an email whose attachment was still rendering) fires via email-me
  // the moment every awaited media id resolves — auto-doing what the manual
  // EMAIL button does. Each intent sends at most once.
  const resolvedMedia = new Map<
    string,
    { status: 'ready'; kind: 'image' | 'video'; blobUrl: string } | { status: 'failed' }
  >();
  const settledIntents = new Set<number>();
  const maybeFlushEmails = (): void => {
    emailIntents.forEach((intent, i) => {
      if (settledIntents.has(i)) return;
      const states = intent.awaitedMediaIds.map((id) => resolvedMedia.get(id));
      if (states.some((s) => s?.status === 'failed')) {
        settledIntents.add(i); // a render failed → never auto-send; in-chat card informs the user
        return;
      }
      if (states.some((s) => s?.status !== 'ready')) return; // still waiting on at least one
      settledIntents.add(i);
      const ready = states as Array<{ status: 'ready'; kind: 'image' | 'video'; blobUrl: string }>;
      void sendEmailMe({
        messageContent: intent.content,
        messageTimestamp: intent.messageTimestamp,
        severity: intent.severity ?? null,
        alertEntityKind: intent.alertEntityKind ?? null,
        alertEntityId: intent.alertEntityId ?? null,
        attachImageUrls: ready.filter((s) => s.kind === 'image').map((s) => s.blobUrl),
        attachVideoUrls: ready.filter((s) => s.kind === 'video').map((s) => s.blobUrl),
      }).then((res) => {
        // Step 0: stamp the "Emailed ✓" badge on the originating message once the
        // deferred send lands. Key by the message's own client timestamp (the
        // intent's messageTimestamp is server-derived and won't match), resolved
        // via the index this poller already tracks.
        if (!res.ok) return;
        const msg = useAgentStore.getState().messages[messageIndex];
        if (msg?.role === 'assistant') {
          useAgentStore.getState().markMessageEmailed(msg.timestamp, Date.now(), res.recipient);
        }
      });
    });
  };

  for (const marker of pending) {
    // Claim the id so AgentDrawer's resume poller doesn't chase the same render
    // in parallel — every video poll costs a provider round-trip.
    const claimId = typeof marker.generatedMediaId === 'string' ? marker.generatedMediaId : null;
    if (claimId && !claimMediaPoll(claimId)) continue;

    void (async () => {
      try {
        for (let attempt = 0; attempt < 180; attempt += 1) {
          await delay(2000);
          try {
            const res = await fetch(marker.pollUrl as string);
            if (!res.ok) continue; // transient HTTP error — keep polling
            const data = (await res.json()) as GeneratedMediaMarker & { ok?: boolean };
            const attachment = attachmentFromMarker({
              __generated_media: true,
              mediaKind: data.mediaKind ?? marker.mediaKind,
              generatedMediaId: data.generatedMediaId ?? marker.generatedMediaId,
              status: data.status,
              pollUrl: data.pollUrl ?? marker.pollUrl,
              blobUrl: data.blobUrl,
              styleTag: data.styleTag ?? marker.styleTag,
              providerJobId: data.providerJobId,
              providerStatus: data.providerStatus,
              errorMessage: data.errorMessage,
            });
            // Keep the video card's provider-status fresh while it runs.
            if (attachment?.mediaKind === 'video') {
              useAgentStore.getState().addGeneratedVideoToMessage(messageIndex, attachment);
            }
            // Surface terminal states (failed OR ready) to the thread. A failed
            // job MUST render — otherwise the user sees nothing despite the
            // agent saying a job started.
            const terminal =
              data.status === 'failed' || (data.status === 'ready' && Boolean(data.blobUrl));
            if (terminal && attachment) {
              if (attachment.mediaKind === 'video') {
                useAgentStore.getState().addGeneratedVideoToMessage(messageIndex, attachment);
              } else {
                useAgentStore.getState().addGeneratedImageToMessage(messageIndex, attachment);
              }
              // Record the resolution for any deferred email awaiting this media.
              const resolvedId =
                typeof data.generatedMediaId === 'string'
                  ? data.generatedMediaId
                  : typeof marker.generatedMediaId === 'string'
                    ? marker.generatedMediaId
                    : null;
              if (resolvedId) {
                if (data.status === 'ready' && typeof data.blobUrl === 'string') {
                  resolvedMedia.set(resolvedId, {
                    status: 'ready',
                    kind: attachment.mediaKind,
                    blobUrl: data.blobUrl,
                  });
                } else if (data.status === 'failed') {
                  resolvedMedia.set(resolvedId, { status: 'failed' });
                }
                maybeFlushEmails();
              }
              return;
            }
          } catch {
            // Keep polling through transient status endpoint failures.
          }
        }
      } finally {
        if (claimId) {
          // Releasing alone isn't enough: AgentDrawer's resume poller only
          // re-claims when `messages` changes, and giving up may be the last
          // event there is. Land a terminal state so the card can't spin
          // forever, which also wakes the drawer effect.
          markGeneratedVideoGaveUp(messageIndex, claimId);
          releaseMediaPoll(claimId);
        }
      }
    })();
  }
}

/**
 * Mark a still-pending VIDEO attachment as failed after a poller exhausts its
 * attempts. No-op for anything already terminal, and for images (their renders
 * finish in 10-30s, so exhausting the loop means something else went wrong and
 * the existing behaviour is unchanged).
 *
 * Shared by both stream hooks (rule #23) and mirrored by AgentDrawer's poller.
 */
export function markGeneratedVideoGaveUp(messageIndex: number, generatedMediaId: string): void {
  const current = useAgentStore
    .getState()
    .messages[messageIndex]?.generatedVideos?.find(
      (item) => item.generatedMediaId === generatedMediaId,
    );
  if (!current || current.status === 'ready' || current.status === 'failed' || current.blobUrl) {
    return;
  }
  useAgentStore.getState().addGeneratedVideoToMessage(messageIndex, {
    ...current,
    status: 'failed',
    errorMessage:
      'Still rendering after 6 minutes — stopped tracking on this tab. Reload to resume, or generate again.',
    updatedAt: Date.now(),
  });
}

export function useAgentStream() {
  const abortRef = useRef<AbortController | null>(null);
  const pendingBriefRef = useRef<{ topic: string; format: string } | null>(null);
  const channelSwitchRef = useRef<import('@/lib/store/companion-store').ChannelSwitchData | null>(
    null,
  );
  const youtubeResultsRef = useRef<{
    autoPlay: import('@/lib/store/youtube-store').YouTubeVideo | null;
    alternatives: import('@/lib/store/youtube-store').YouTubeVideo[];
    query: string;
  } | null>(null);
  const generatedMediaRef = useRef<GeneratedMediaMarker[]>([]);
  const emailWhenReadyRef = useRef<EmailWhenReadyIntent[]>([]);
  // Step 0 (email detour): a conversational email that sent inline (named
  // recipient or already-ready media) — badge the originating message after it
  // is created. The tool result arrives mid-stream, before the assistant
  // message exists, so we stash the recipient and apply the badge post-stream.
  const emailedInlineRef = useRef<{ recipient?: string } | null>(null);
  const {
    setStatus,
    setCurrentTask,
    appendStreamingText,
    clearStreamingText,
    setIsStreaming,
    setLatestResponse,
    setDetectedMode,
    addToolCall,
    addToHistory,
    addBrief,
    startConversation,
    completeConversation,
    failConversation,
    addToolCallToConversation,
  } = useAgentStore();

  const invoke = useCallback(
    async (task: string, mode?: 'concise' | 'standard') => {
      // Abort any existing stream
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      clearStreamingText();
      setStatus('thinking');
      setCurrentTask(task);
      setIsStreaming(true);
      const readyActiveAttachments = useAgentStore
        .getState()
        .activeAttachments.filter((attachment) => attachment.status === 'ready');
      const messageAttachments = readyActiveAttachments.slice(-MAX_ATTACHMENTS_PER_MESSAGE);
      const attachmentIds = messageAttachments.map((attachment) => attachment.id);
      addToHistory(task, messageAttachments);
      channelSwitchRef.current = null;
      youtubeResultsRef.current = null;
      generatedMediaRef.current = [];
      emailWhenReadyRef.current = [];
      emailedInlineRef.current = null;
      streamMaxZoom = 0;
      streamHasFlyTo = false;
      suppressMapMovement = false;
      const conversationId = startConversation(task);

      try {
        // Capture viewport snapshot for spatial intelligence tools
        const mapState = useMapStore.getState();
        const map = getMapInstance();
        const viewportSnapshot = map
          ? captureViewportSnapshot(map, {
              baseStyle: mapState.baseStyle,
              activeLayers: [...mapState.activeLayers],
              klammerMarkers: mapState.markers.slice(0, 20).map((m) => ({
                label: m.label ?? m.id,
                category: m.category,
                severity: m.severity ?? 'info',
              })),
            })
          : null;

        // Fall back to basic map context if no map instance
        const mapContext = viewportSnapshot ?? {
          zoomTier: mapState.currentZoomTier,
          bounds: mapState.viewportBounds,
          visibleMarkerCount: mapState.markers.length,
        };

        // Detect if YouTube panel is fullscreened — send youtubeVideoId instead of channelId
        const { fullscreenSlot, slotAssignments } = usePanelsStore.getState();
        const fullscreenPanelId = fullscreenSlot ? slotAssignments[fullscreenSlot] : undefined;
        const isYouTubeFullscreen = fullscreenPanelId === 'youtubeSearch';
        const ytVideo = isYouTubeFullscreen ? useYouTubeStore.getState().currentVideo : null;

        // Always send channelId; use engagementLevel to control cache TTL
        const channelId = isYouTubeFullscreen ? null : getActiveChannelId();
        const isTvQuery = isTvRelatedQuery(task);
        const rawSwitchQuery = isChannelSwitchQuery(task);
        const isYtSearch = isYouTubeSearchQuery(task);
        const isGeoQuery = isGeographicQuery(task);
        const isSwitchQuery = rawSwitchQuery && !isGeoQuery;

        // Grab raw caption tail for on-demand context (skip for switch requests, YT search, and YouTube fullscreen)
        let captionText: string | undefined;
        if (channelId && isTvQuery && !isSwitchQuery && !isYtSearch) {
          const recentCues = getRecentCues(channelId, 30_000);
          if (recentCues.length > 0) {
            captionText = recentCues.join(' ');
          }
        }

        // Send recent messages as fallback conversation context for the server
        const recentMessages = useAgentStore
          .getState()
          .messages.slice(-10)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

        // Manifest of media generated this session (tool- OR IMG/VID-button-created),
        // so the agent knows it exists and can attach it by id (e.g. email_conversation).
        const sessionMedia = buildSessionMediaManifest(useAgentStore.getState().messages);

        // For channel switch requests, don't send channelId — prevents TV context injection server-side
        // The focused hint and TV context discourage the agent from calling tv_switch_channel
        // YouTube search queries should NOT trigger TV context injection
        // YouTube fullscreen: send youtubeVideoId instead of channelId
        const tvParams = ytVideo?.videoId
          ? { youtubeVideoId: ytVideo.videoId, engagementLevel: 'focused' as const }
          : channelId && isTvQuery && !isYtSearch
            ? isSwitchQuery
              ? {}
              : { channelId, engagementLevel: 'focused' as const }
            : {};

        // Extract panel metadata from <context> tag for server-side correlation
        let panelMeta: { sourcePanel?: string; dataType?: string } = {};
        let sourceContext: import('@/lib/visual/visual-brief').VisualBriefSourceContext | undefined;
        const ctxMatch = task.match(/<context>([\s\S]*?)<\/context>/);
        if (ctxMatch?.[1]) {
          try {
            const parsed = JSON.parse(ctxMatch[1]) as Record<string, unknown>;
            panelMeta = {
              sourcePanel: parsed.sourcePanel as string | undefined,
              dataType: parsed.dataType as string | undefined,
            };
            sourceContext = parsed as import('@/lib/visual/visual-brief').VisualBriefSourceContext;
          } catch {
            /* ignore malformed context */
          }
        }

        // Detect "Analyze this location" from map right-click — suppress all camera movement
        const isMapLocationAnalysis = panelMeta.dataType === 'map_location';
        if (isMapLocationAnalysis) {
          suppressMapMovement = true;
        }

        const response = await fetch('/api/agent/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task,
            recentMessages,
            responseMode: mode ?? useAgentStore.getState().responseMode,
            // Phase 14 — closure-fresh read of the lock per Rule #24. The user
            // may have toggled the pill between renders; this captures the
            // lock as of the click that triggered this invoke.
            lockedMode: useAgentStore.getState().lockedMode,
            mapContext,
            ...tvParams,
            ...(captionText ? { captionText } : {}),
            ...(isSwitchQuery ? { switchIntent: true } : {}),
            ...(isGeoQuery && !isMapLocationAnalysis ? { geoIntent: true } : {}),
            ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
            ...(sessionMedia.length > 0 ? { sessionMedia } : {}),
            ...panelMeta,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Agent returned ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        // Phase 14 — three-mode posture marker handling.
        //
        // The model emits `[[MODE:anchor|analyst|fix-architect]]` as the FIRST
        // line of every response. We:
        //   1. Buffer text chunks until we've either found the marker or
        //      accumulated enough chars to be confident there's none.
        //   2. Once resolved: call setDetectedMode + emit only post-marker
        //      content to the live streaming view (so the user never sees the
        //      raw `[[MODE:...]]` token).
        //   3. After the stream ends, a belt-and-braces re-extract from the
        //      final `fullText` ensures the persisted message is also clean.
        let markerProcessed = false;
        let detectedAgentMode: AgentMode = 'anchor';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();

            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data) as {
                type:
                  | 'text'
                  | 'tool_use'
                  | 'tool_result'
                  | 'tool_start'
                  | 'message_start'
                  | 'done'
                  | 'error';
                data: string;
              };

              if (parsed.type === 'message_start') {
                // Early metadata — model info available before content streams
                // Could be used for UI indicators in the future
              } else if (parsed.type === 'tool_start') {
                // Tool name available before full input streams
                const toolStart = JSON.parse(parsed.data) as { name: string };
                setStatus('thinking');
                setCurrentTask(`Using ${toolStart.name}...`);
              } else if (parsed.type === 'text') {
                fullText += parsed.data;
                setStatus('acting');

                if (markerProcessed) {
                  appendStreamingText(parsed.data);
                } else {
                  // Try to resolve the marker from the accumulated text.
                  const { mode, stripped } = extractModeMarker(fullText);
                  if (mode !== null) {
                    detectedAgentMode = mode;
                    markerProcessed = true;
                    setDetectedMode(mode);
                    // First time we emit anything to streamingText for this
                    // response — make sure earlier chunks (which we deferred
                    // while buffering) don't reappear. clearStreamingText is
                    // safe here because nothing has been appended yet this
                    // turn (the buffering branch never called appendStreamingText).
                    clearStreamingText();
                    if (stripped.length > 0) appendStreamingText(stripped);
                  } else if (fullText.length > 100) {
                    // 100 chars in and still no marker — model skipped it or
                    // emitted something malformed. Stop buffering: dump what
                    // we have to the live view and continue normally. The
                    // detectedAgentMode stays at the 'anchor' default.
                    markerProcessed = true;
                    clearStreamingText();
                    appendStreamingText(fullText);
                  }
                  // else: keep buffering — marker may still arrive in the next chunk.
                }
              } else if (parsed.type === 'tool_use') {
                const toolData = JSON.parse(parsed.data) as {
                  name: string;
                  input: Record<string, unknown>;
                };
                const toolCall = {
                  name: toolData.name,
                  input: toolData.input,
                  output: null,
                  timestamp: Date.now(),
                };
                addToolCall(toolCall);
                addToolCallToConversation(conversationId, toolCall);
                setStatus('thinking');
              } else if (parsed.type === 'tool_result') {
                const resultData = JSON.parse(parsed.data) as {
                  name: string;
                  output: Record<string, unknown>;
                };
                if (resultData.output && '__map_command' in resultData.output) {
                  handleMapCommand(resultData.output);
                }
                if (resultData.output && '__cyber_geo_command' in resultData.output) {
                  handleCyberGeoCommand(resultData.output);
                }
                if (resultData.output && '__channel_command' in resultData.output) {
                  handleChannelCommand(resultData.output);
                  const out = resultData.output;
                  channelSwitchRef.current = {
                    channelId: out.channelId as string,
                    channelLabel: out.channelLabel as string,
                    category:
                      out.category as import('@/lib/store/companion-store').ChannelSwitchData['category'],
                    nowPlaying:
                      (out.nowPlaying as import('@/lib/store/companion-store').ChannelSwitchData['nowPlaying']) ??
                      null,
                  };
                }
                if (resultData.output && '__youtube_command' in resultData.output) {
                  handleYouTubeCommand(resultData.output as Record<string, unknown>);
                  if (
                    (resultData.output as Record<string, unknown>).__youtube_command ===
                    'search_results'
                  ) {
                    const out = resultData.output as Record<string, unknown>;
                    type YTVideo = import('@/lib/store/youtube-store').YouTubeVideo;
                    youtubeResultsRef.current = {
                      autoPlay: (out.autoPlay as YTVideo) ?? null,
                      alternatives: (out.alternatives ?? []) as YTVideo[],
                      query: (out.query as string) ?? '',
                    };
                  }
                }
                if (resultData.output && '__generated_media' in resultData.output) {
                  const out = resultData.output as Record<string, unknown>;
                  if (isGeneratedMediaMarker(out)) {
                    generatedMediaRef.current = [...generatedMediaRef.current, out];
                    setCurrentTask(
                      out.mediaKind === 'video'
                        ? 'Generating Seedance video...'
                        : 'Generating image...',
                    );
                  }
                }
                if (resultData.output && '__brief' in resultData.output) {
                  const briefData = resultData.output as { topic: string; format: string };
                  pendingBriefRef.current = {
                    topic: briefData.topic,
                    format: briefData.format,
                  };
                }
                if (resultData.output && '__email_when_ready' in resultData.output) {
                  const intent = (
                    resultData.output as { __email_when_ready?: EmailWhenReadyIntent }
                  ).__email_when_ready;
                  if (intent && Array.isArray(intent.awaitedMediaIds) && intent.content) {
                    emailWhenReadyRef.current = [...emailWhenReadyRef.current, intent];
                  }
                }
                // Step 0: an email_conversation that DELIVERED inline (named
                // recipient or already-ready media). Stash the recipient; the
                // badge is applied once the assistant message exists (below).
                if (
                  resultData.output &&
                  'delivered' in resultData.output &&
                  'recipients' in resultData.output &&
                  (resultData.output as { delivered?: boolean }).delivered === true
                ) {
                  const out = resultData.output as { to?: unknown };
                  emailedInlineRef.current = {
                    recipient: Array.isArray(out.to)
                      ? (out.to[0] as string | undefined)
                      : undefined,
                  };
                }
              } else if (parsed.type === 'error') {
                setStatus('error');
              }
            } catch {
              // Malformed SSE line, skip
            }
          }
        }

        // Phase 14.5 (code-review fix #15) — flush the live-stream buffer
        // if it was stalled. When the model omits the [[MODE:...]] marker
        // AND the response is shorter than the 100-char no-marker fallback
        // threshold, the streaming branch's `else: keep buffering` path
        // ran for every chunk and `appendStreamingText` was never called.
        // Without this flush, the user sees the 'Analyzing...' indicator
        // for the whole stream and the text materializes only via
        // setLatestResponse after the stream ends — breaking the live-typing
        // UX cue.
        if (!markerProcessed && fullText.length > 0) {
          clearStreamingText();
          appendStreamingText(stripAllModeMarkers(fullText));
          markerProcessed = true;
        }

        // Phase 14 — belt-and-braces marker re-extraction. The streaming-path
        // marker logic strips the marker from the live view, but if the
        // response was shorter than the 100-char no-marker threshold the
        // raw marker may still be in `fullText`. Strip it before citations
        // and persistence touch the text.
        const finalMarker = extractModeMarker(fullText);
        if (finalMarker.mode !== null) {
          detectedAgentMode = finalMarker.mode;
          fullText = finalMarker.stripped;
          // Ensure the store reflects the final detected mode even if the
          // streaming branch never resolved it (very short responses).
          setDetectedMode(finalMarker.mode);
        }

        // Phase 14.5 (code-review fix #4) — catch markers in BODY position
        // that the anchored extract above misses. The agent's multi-turn
        // loop can interleave text and tool calls, so a marker can land mid-
        // text after a tool-result narration prefix. Without this scrub,
        // markers leak into the persisted message, brief, Twitter post,
        // and email digest. Idempotent on already-clean text.
        fullText = stripAllModeMarkers(fullText);

        // Post-stream citation validation, repair, and source aggregation
        const validation = validateCitations(fullText);
        fullText = validation.text;
        if (validation.repairCount > 0) {
          console.info(
            `[citation-validator] Repaired ${validation.repairCount} citation(s):`,
            validation.repairs,
          );
        }

        const readyAttachments = generatedMediaRef.current
          .map(attachmentFromMarker)
          .filter((item): item is NonNullable<typeof item> => item != null);

        setLatestResponse(
          { text: fullText, toolCalls: [], model: 'claude-sonnet-4-6' },
          channelSwitchRef.current ?? undefined,
          validation.repairCount > 0 ? validation.repairCount : undefined,
          youtubeResultsRef.current ?? undefined,
          sourceContext,
          {
            images: readyAttachments.filter((item) => item.mediaKind === 'image'),
            videos: readyAttachments.filter((item) => item.mediaKind === 'video'),
          },
          messageAttachments,
          detectedAgentMode,
        );
        const assistantMessageIndex = useAgentStore.getState().messages.length - 1;
        // Step 0: an inline email_conversation send → "Emailed ✓" badge on this message.
        if (emailedInlineRef.current) {
          const msg = useAgentStore.getState().messages[assistantMessageIndex];
          if (msg?.role === 'assistant') {
            useAgentStore
              .getState()
              .markMessageEmailed(msg.timestamp, Date.now(), emailedInlineRef.current.recipient);
          }
          emailedInlineRef.current = null;
        }
        void pollGeneratedMediaForMessage(
          assistantMessageIndex,
          generatedMediaRef.current,
          emailWhenReadyRef.current,
        );
        completeConversation(conversationId, fullText);

        // If this conversation generated a brief, save it
        if (pendingBriefRef.current && fullText.length > 100) {
          const { topic, format } = pendingBriefRef.current;
          const briefContent = stripPreamble(fullText);
          const headline = extractHeadline(briefContent, topic);

          const brief: BriefSummary = {
            id: `brief-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            headline,
            format: format as BriefFormat,
            confidence: extractConfidence(briefContent),
            timestamp: new Date().toISOString(),
            content: briefContent,
            conversationId,
          };

          addBrief(brief);

          // Fire-and-forget DB save
          fetch('/api/agent/briefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(brief),
          }).catch(() => {
            /* best-effort */
          });

          pendingBriefRef.current = null;
        }

        // Auto-extract locations from agent response for ephemeral markers
        if (fullText.length > 50) {
          try {
            const { extractLocationsFromText } = await import('@/lib/agent/extract-locations');
            const locations = extractLocationsFromText(fullText);
            if (locations.length > 0) {
              const { addAgentIntelMarkers, agentIntelMarkers } = useDataStore.getState();
              const autoMarkers: AgentIntelMarker[] = locations
                .filter((loc) => {
                  // Don't create auto markers near explicit agent markers
                  return !agentIntelMarkers.some(
                    (m) => greatCircleDistance(m.lat, m.lon, loc.lat, loc.lon) < 50,
                  );
                })
                .map((loc, i) => ({
                  id: `agent-auto-${Date.now()}-${i}`,
                  lat: loc.lat,
                  lon: loc.lon,
                  label: loc.name,
                  description: loc.context,
                  severity: 'info' as const,
                  category: 'strategic' as IntelligenceCategory,
                  source: 'agent' as const,
                  confidence: 0.6,
                  ttl: 30,
                  createdAt: Date.now(),
                  glowColor: '#4488ff',
                }));
              if (autoMarkers.length > 0) {
                addAgentIntelMarkers(autoMarkers);
              }
            }
          } catch {
            // Auto-extraction is best-effort
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          failConversation(conversationId);
          setStatus('error');
          console.error('[Agent Stream Error]', err);
        }
      } finally {
        setIsStreaming(false);
        suppressMapMovement = false;
      }
    },
    [
      setStatus,
      setCurrentTask,
      appendStreamingText,
      clearStreamingText,
      setIsStreaming,
      setLatestResponse,
      setDetectedMode,
      addToolCall,
      addToHistory,
      addBrief,
      startConversation,
      completeConversation,
      failConversation,
      addToolCallToConversation,
    ],
  );

  const expand = useCallback(async (messageIndex: number, originalText: string) => {
    const store = useAgentStore.getState();
    store.expandMessage(messageIndex);

    const expandPrompt = `Expand your previous concise analysis into a standard SITREP. Previous analysis: "${originalText.slice(0, 500)}"`;

    try {
      const attachmentIds = store.activeAttachments
        .filter((attachment) => attachment.status === 'ready')
        .slice(-MAX_ATTACHMENTS_PER_MESSAGE)
        .map((attachment) => attachment.id);
      const recentMessages = store.messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content.slice(0, 1000),
      }));
      const sessionMedia = buildSessionMediaManifest(store.messages);

      const response = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: expandPrompt,
          responseMode: 'standard',
          recentMessages,
          ...(sessionMedia.length > 0 ? { sessionMedia } : {}),
          // Phase 14.5 (code-review fix #8) — expand() honors the user's
          // posture lock. Without this, the lock floor is silently bypassed
          // on every expand action; the server's computeEffectiveMode would
          // treat the call as AUTO.
          lockedMode: useAgentStore.getState().lockedMode,
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        }),
      });

      if (!response.ok) {
        store.completeExpansion(messageIndex);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        store.completeExpansion(messageIndex);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      // Phase 14.5 (code-review fix #11) — strip the [[MODE:...]] marker
      // from expansion chunks. Without this, the raw marker lands at the
      // start of the persisted message.expansion field. We accumulate the
      // full expansion text here and append in marker-aware tranches.
      let expansionBuffer = '';
      let expansionMarkerProcessed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data) as { type: string; data: string };
            if (parsed.type === 'text') {
              expansionBuffer += parsed.data;
              if (expansionMarkerProcessed) {
                store.appendExpansion(messageIndex, parsed.data);
              } else {
                const { mode, stripped } = extractModeMarker(expansionBuffer);
                if (mode !== null) {
                  expansionMarkerProcessed = true;
                  if (stripped.length > 0) {
                    store.appendExpansion(messageIndex, stripped);
                  }
                } else if (expansionBuffer.length > 100) {
                  expansionMarkerProcessed = true;
                  store.appendExpansion(messageIndex, expansionBuffer);
                }
                // else: keep buffering until marker resolves or threshold trips
              }
            }
          } catch {
            // Malformed SSE line, skip
          }
        }
      }

      // Belt-and-braces — strip any body-position markers and flush any
      // sub-100-char buffer that never resolved.
      if (!expansionMarkerProcessed && expansionBuffer.length > 0) {
        store.appendExpansion(messageIndex, stripAllModeMarkers(expansionBuffer));
      }
    } catch {
      // Expansion is best-effort
    } finally {
      store.completeExpansion(messageIndex);
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStatus('idle');
  }, [setIsStreaming, setStatus]);

  return { invoke, abort, expand };
}

'use client';

import { useCallback, useRef } from 'react';
import { type AgentMode, extractModeMarker, stripAllModeMarkers } from '@/lib/agent/mode-config';
import { buildSessionMediaManifest } from '@/lib/agent/session-media';
import { getRecentCues } from '@/lib/captions/caption-bridge';
import { claimMediaPoll, releaseMediaPoll } from '@/lib/hooks/media-poll-registry';
import { markGeneratedVideoGaveUp } from '@/lib/hooks/use-agent-stream';
import { sendEmailMe } from '@/lib/outbound/send-email-me';
import { useAgentStore } from '@/lib/store/agent-store';
import type { ChannelSwitchData } from '@/lib/store/companion-store';
import { useCompanionStore } from '@/lib/store/companion-store';
import { useDataStore } from '@/lib/store/data-store';
import { useMapStore } from '@/lib/store/map-store';
import { usePanelsStore } from '@/lib/store/panels-store';
import type { AgentIntelMarker, GlobeLayer, IntelligenceCategory, Severity } from '@/lib/types';
import { flyToActor, flyToBreach, flyToCVE } from '@/lib/utils/cyber-fly';
import { severityToHex } from '@/lib/utils/geo';

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

/** When true, suppress all map camera movements (flyTo) but allow markers/pulses.
 *  Set when the user right-clicks "Analyze this location" — they are already viewing
 *  the exact location and camera movement would disrupt their view. */
let suppressMapMovement = false;

/** Smart routing mirror of use-agent-stream (CLAUDE.md rule #23). */
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
        // Dual-stream parity with use-agent-stream (CLAUDE.md rule #23):
        // explicit fly_to locks rotation until user drag/toggle.
        store.flyTo(lat, lon, zoom, { lock: true });
      }
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
      if (!suppressMapMovement) {
        store.flyTo(lat, lon, 6);
      }
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

      if (!suppressMapMovement && intelMarkers.length > 0) {
        const avgLat = intelMarkers.reduce((s, m) => s + m.lat, 0) / intelMarkers.length;
        const avgLon = intelMarkers.reduce((s, m) => s + m.lon, 0) / intelMarkers.length;
        store.flyTo(avgLat, avgLon, intelMarkers.length === 1 ? 8 : 5);
      }
      break;
    }
  }
}

/**
 * Process cyber-geo commands returned from AEGIS tool calls — same shape as
 * use-agent-stream.ts. Required for dual-stream parity (Rule #23 from
 * CLAUDE.md): without this, rich cyber markers appear in the drawer but the
 * companion sidebar won't drive the globe.
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

/** A conversational email queued until its still-rendering attachment is ready. */
type EmailWhenReadyIntent = {
  awaitedMediaIds: string[];
  content: string;
  severity?: string;
  alertEntityKind?: string;
  alertEntityId?: string;
  messageTimestamp: number;
};

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
  // Shared resolution state so a deferred "email when ready" send fires via
  // email-me once every awaited media id resolves (parity with the main drawer
  // hook — Rule #23). Each intent sends at most once.
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
        settledIntents.add(i);
        return;
      }
      if (states.some((s) => s?.status !== 'ready')) return;
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
        // Mirror of use-agent-stream (Rule #23): stamp "Emailed ✓" once the
        // deferred send lands, keyed by the message's own client timestamp.
        if (!res.ok) return;
        const msg = useAgentStore.getState().messages[messageIndex];
        if (msg?.role === 'assistant') {
          useAgentStore.getState().markMessageEmailed(msg.timestamp, Date.now(), res.recipient);
        }
      });
    });
  };

  for (const marker of markers) {
    if (
      marker.status !== 'pending' ||
      typeof marker.pollUrl !== 'string' ||
      !marker.pollUrl.startsWith('/api/outbound/generated-media/')
    ) {
      continue;
    }
    // Rule #23 parity with use-agent-stream: claim the id so AgentDrawer's
    // resume poller doesn't chase the same render in parallel.
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
          // Rule #23 parity: same terminal give-up as use-agent-stream, so the
          // card can't spin forever after the poller stops.
          markGeneratedVideoGaveUp(messageIndex, claimId);
          releaseMediaPoll(claimId);
        }
      }
    })();
  }
}

/**
 * Simplified streaming hook for companion mode chat.
 * Posts to /api/agent/stream with companionMode: true and concise response mode.
 * Reads/writes companion-store instead of agent-store.
 * Processes __map_command markers but NOT __brief markers.
 */
export function useCompanionStream() {
  const abortRef = useRef<AbortController | null>(null);
  const channelSwitchRef = useRef<ChannelSwitchData | null>(null);
  const youtubeResultsRef = useRef<{
    autoPlay: import('@/lib/store/youtube-store').YouTubeVideo | null;
    alternatives: import('@/lib/store/youtube-store').YouTubeVideo[];
    query: string;
  } | null>(null);
  const generatedMediaRef = useRef<GeneratedMediaMarker[]>([]);
  const emailWhenReadyRef = useRef<EmailWhenReadyIntent[]>([]);
  // Step 0 (email detour) — mirror of use-agent-stream (Rule #23): badge a
  // conversational inline email send once the assistant message exists.
  const emailedInlineRef = useRef<{ recipient?: string } | null>(null);
  const {
    appendCompanionStreamingText,
    setCompanionStreamingText,
    setIsCompanionStreaming,
    addCompanionMessage,
  } = useCompanionStore();

  const invoke = useCallback(
    async (task: string) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setCompanionStreamingText('');
      setIsCompanionStreaming(true);
      channelSwitchRef.current = null;
      youtubeResultsRef.current = null;
      generatedMediaRef.current = [];
      emailWhenReadyRef.current = [];
      emailedInlineRef.current = null;

      // Add user message
      addCompanionMessage({
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: task,
        timestamp: new Date().toISOString(),
      });

      // Mirror to agent store for unified log
      useAgentStore.getState().addMessage({
        role: 'user',
        content: task,
        timestamp: Date.now(),
        origin: 'companion',
      });

      try {
        // Read freshest activeChannelId from store (avoid stale closure)
        const freshChannelId = useCompanionStore.getState().activeChannelId;

        // Determine if this is a YouTube companion session
        const isYouTube = freshChannelId?.startsWith('youtube:') ?? false;
        const youtubeVideoId = isYouTube ? freshChannelId!.slice('youtube:'.length) : null;

        // Read active channel at invoke time from localStorage (freshest value)
        // For YouTube, we already have the video ID from the store
        const currentChannelId = isYouTube
          ? null
          : (localStorage.getItem('klammer-active-channel') ?? freshChannelId ?? null);

        // Detect channel switch intent
        const switchPhrases = [
          'switch to',
          'change to',
          'put on',
          'tune to',
          'turn on',
          'change the channel',
          'change channel',
          'go to',
          'flip to',
        ];
        const isSwitchQuery = switchPhrases.some((p) => task.toLowerCase().includes(p));
        const isGeoQuery = !isSwitchQuery && isGeographicQuery(task);

        // Detect "Analyze this location" from map right-click — suppress all camera movement
        let isMapLocationAnalysis = false;
        let companionPanelMeta: { sourcePanel?: string; dataType?: string } = {};
        const ctxMatch = task.match(/<context>([\s\S]*?)<\/context>/);
        if (ctxMatch?.[1]) {
          try {
            const parsed = JSON.parse(ctxMatch[1]) as Record<string, unknown>;
            companionPanelMeta = {
              sourcePanel: parsed.sourcePanel as string | undefined,
              dataType: parsed.dataType as string | undefined,
            };
            isMapLocationAnalysis = parsed.dataType === 'map_location';
          } catch {
            /* ignore malformed context */
          }
        }
        if (isMapLocationAnalysis) {
          suppressMapMovement = true;
        }

        // Grab raw caption tail (skip for YouTube — no caption bridge data)
        let captionText: string | undefined;
        if (!isYouTube && currentChannelId && !isSwitchQuery) {
          const recentCues = getRecentCues(currentChannelId, 30_000);
          if (recentCues.length > 0) {
            captionText = recentCues.join(' ');
          }
        }

        // Companion-created media is attached to agent-store messages (same store
        // as the drawer), so this manifest covers both surfaces' session media.
        const sessionMedia = buildSessionMediaManifest(useAgentStore.getState().messages);

        const response = await fetch('/api/agent/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task,
            responseMode: 'concise',
            companionMode: true,
            engagementLevel: 'focused',
            ...(sessionMedia.length > 0 ? { sessionMedia } : {}),
            // Phase 14 — closure-fresh lock read (Rule #24). The companion
            // path honors the same user-driven lock as the main drawer.
            lockedMode: useAgentStore.getState().lockedMode,
            ...(youtubeVideoId ? { youtubeVideoId } : {}),
            ...(currentChannelId ? { channelId: currentChannelId } : {}),
            ...(captionText ? { captionText } : {}),
            ...(isSwitchQuery ? { switchIntent: true } : {}),
            ...(isGeoQuery && !isMapLocationAnalysis ? { geoIntent: true } : {}),
            ...companionPanelMeta,
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
        let isError = false;

        // Phase 14 — three-mode posture marker handling (mirror of
        // use-agent-stream.ts per Rule #23 dual-stream marker parity). The
        // model emits `[[MODE:...]]` as the first line of every response;
        // we buffer chunks until the marker is resolved, then emit only the
        // post-marker text to companion streamingText so the user never sees
        // the raw marker.
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

              if (parsed.type === 'text') {
                fullText += parsed.data;

                if (markerProcessed) {
                  appendCompanionStreamingText(parsed.data);
                } else {
                  const { mode, stripped } = extractModeMarker(fullText);
                  if (mode !== null) {
                    detectedAgentMode = mode;
                    markerProcessed = true;
                    useAgentStore.getState().setDetectedMode(mode);
                    // Replace streamingText with the stripped post-marker
                    // content (nothing has been emitted yet this turn —
                    // we deferred while buffering).
                    setCompanionStreamingText(stripped);
                  } else if (fullText.length > 100) {
                    // No marker found after 100 chars — dump what we have
                    // and continue normally. detectedAgentMode stays at the
                    // default 'anchor'.
                    markerProcessed = true;
                    setCompanionStreamingText(fullText);
                  }
                  // else: continue buffering.
                }
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
                  // Capture channel switch data for the ChannelSwitchCard
                  const out = resultData.output;
                  channelSwitchRef.current = {
                    channelId: out.channelId as string,
                    channelLabel: out.channelLabel as string,
                    category: out.category as ChannelSwitchData['category'],
                    nowPlaying: (out.nowPlaying as ChannelSwitchData['nowPlaying']) ?? null,
                  };
                }
                if (resultData.output && '__youtube_command' in resultData.output) {
                  const out = resultData.output;
                  if (out.__youtube_command === 'search_results') {
                    type YTVideo = import('@/lib/store/youtube-store').YouTubeVideo;
                    youtubeResultsRef.current = {
                      autoPlay: (out.autoPlay as YTVideo) ?? null,
                      alternatives: (out.alternatives ?? []) as YTVideo[],
                      query: (out.query as string) ?? '',
                    };
                    // Smart routing: hero LIVE tab if active, otherwise grid YouTube panel.
                    const eventName = isHeroLiveActive()
                      ? 'klammer-hero-youtube-play'
                      : 'klammer-youtube-play';
                    window.dispatchEvent(
                      new CustomEvent(eventName, {
                        detail: {
                          type: 'search_results',
                          autoPlay: out.autoPlay,
                          alternatives: out.alternatives,
                          query: out.query,
                        },
                      }),
                    );
                  }
                }
                if (resultData.output && '__generated_media' in resultData.output) {
                  const out = resultData.output as Record<string, unknown>;
                  if (isGeneratedMediaMarker(out)) {
                    generatedMediaRef.current = [...generatedMediaRef.current, out];
                  }
                }
                if (resultData.output && '__email_when_ready' in resultData.output) {
                  const intent = (
                    resultData.output as { __email_when_ready?: EmailWhenReadyIntent }
                  ).__email_when_ready;
                  if (intent && Array.isArray(intent.awaitedMediaIds) && intent.content) {
                    emailWhenReadyRef.current = [...emailWhenReadyRef.current, intent];
                  }
                }
                // Step 0 (Rule #23): an email_conversation that DELIVERED inline.
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
                // NOTE: __brief markers are intentionally NOT processed in companion mode
              } else if (parsed.type === 'error') {
                isError = true;
                fullText += `${fullText ? '\n\n' : ''}${parsed.data}`;
                setCompanionStreamingText(stripAllModeMarkers(fullText));
                markerProcessed = true;
              }
            } catch {
              // Malformed SSE line, skip
            }
          }
        }

        // Phase 14.5 (code-review fix #15) — flush stalled buffer (see
        // use-agent-stream.ts). Mirror per Rule #23.
        if (!markerProcessed && fullText.length > 0) {
          setCompanionStreamingText(stripAllModeMarkers(fullText));
          markerProcessed = true;
        }

        // Phase 14 — belt-and-braces marker re-extraction (mirror of
        // use-agent-stream). Short responses may finish before the
        // streaming-path 100-char threshold triggers, leaving the raw
        // marker in fullText. Strip it before persistence.
        const finalMarker = extractModeMarker(fullText);
        if (finalMarker.mode !== null) {
          detectedAgentMode = finalMarker.mode;
          fullText = finalMarker.stripped;
          useAgentStore.getState().setDetectedMode(finalMarker.mode);
        }

        // Phase 14.5 (code-review fix #4) — body-position marker scrub.
        // See use-agent-stream.ts for the rationale. Mirror per Rule #23.
        fullText = stripAllModeMarkers(fullText);

        const readyAttachments = generatedMediaRef.current
          .map(attachmentFromMarker)
          .filter((item): item is NonNullable<typeof item> => item != null);

        // Add assistant message
        addCompanionMessage({
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: fullText,
          isError,
          timestamp: new Date().toISOString(),
          ...(channelSwitchRef.current ? { channelSwitch: channelSwitchRef.current } : {}),
          ...(youtubeResultsRef.current ? { youtubeResults: youtubeResultsRef.current } : {}),
          ...(readyAttachments.some((item) => item.mediaKind === 'image')
            ? { generatedImages: readyAttachments.filter((item) => item.mediaKind === 'image') }
            : {}),
          ...(readyAttachments.some((item) => item.mediaKind === 'video')
            ? { generatedVideos: readyAttachments.filter((item) => item.mediaKind === 'video') }
            : {}),
        });

        // Mirror to agent store for unified log
        useAgentStore.getState().addMessage({
          role: 'assistant',
          content: fullText,
          isError,
          timestamp: Date.now(),
          origin: 'companion',
          agentMode: detectedAgentMode,
          ...(channelSwitchRef.current ? { channelSwitch: channelSwitchRef.current } : {}),
          ...(youtubeResultsRef.current ? { youtubeResults: youtubeResultsRef.current } : {}),
          ...(readyAttachments.some((item) => item.mediaKind === 'image')
            ? { generatedImages: readyAttachments.filter((item) => item.mediaKind === 'image') }
            : {}),
          ...(readyAttachments.some((item) => item.mediaKind === 'video')
            ? { generatedVideos: readyAttachments.filter((item) => item.mediaKind === 'video') }
            : {}),
        });
        const assistantMessageIndex = useAgentStore.getState().messages.length - 1;
        // Step 0 (Rule #23): inline email_conversation send → "Emailed ✓" badge.
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
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[Companion Stream Error]', err);
        }
      } finally {
        setIsCompanionStreaming(false);
        suppressMapMovement = false;
      }
    },
    [
      appendCompanionStreamingText,
      setCompanionStreamingText,
      setIsCompanionStreaming,
      addCompanionMessage,
    ],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsCompanionStreaming(false);
  }, [setIsCompanionStreaming]);

  return { invoke, abort };
}

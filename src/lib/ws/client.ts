'use client';

// ═══════════════════════════════════════════════
// KLAMMER MONITOR - WebSocket Client Hooks
// Auto-reconnecting client with Zustand integration
// ═══════════════════════════════════════════════

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { APPROVAL_QUEUE_KEY } from '@/lib/hooks/use-approval-queue';
import type { DraftRow } from '@/lib/outbound/drafts';
import { useAgentStore } from '@/lib/store/agent-store';
import { useAlertsStore } from '@/lib/store/alerts-store';
import { useDataStore } from '@/lib/store/data-store';
import { CYBER_CHANNELS, cyberChannelToQueryKeys } from '@/lib/ws/cyber-channels';
import type { WSChannel, WSMessage } from '@/lib/ws/server';

// ─── Types ───

interface UseWebSocketReturn {
  connected: boolean;
  lastMessage: WSMessage | null;
  sendMessage: (data: unknown) => void;
}

// ─── Constants ───

const INITIAL_RECONNECT_DELAY = 2_000;
const MAX_RECONNECT_DELAY = 60_000;
const RECONNECT_MULTIPLIER = 2;
const MAX_RECONNECT_ATTEMPTS = 5;

function getWSUrl(): string {
  if (typeof window === 'undefined') return '';

  // Phase 13 Tier 2 — production hosts the WebSocket server on Fly.io
  // (Vercel doesn't support long-lived WS). When the deploy sets
  // NEXT_PUBLIC_WS_URL (e.g. `wss://relay.example.org`), use
  // that absolute URL. Dev (and the legacy `npm run dev:full` custom
  // server) falls back to same-origin so localhost:3002/ws still works.
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured && configured.length > 0) {
    return configured.endsWith('/ws') ? configured : `${configured.replace(/\/+$/, '')}/ws`;
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

// ─── useWebSocket Hook ───

export function useWebSocket(channels: WSChannel[]): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const everConnectedRef = useRef(false);
  const mountedRef = useRef(true);
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const url = getWSUrl();

  useEffect(() => {
    mountedRef.current = true;
    if (!url) return;

    async function connect() {
      if (!mountedRef.current) return;

      let ticket: string;
      try {
        const response = await fetch('/api/ws/token', { method: 'POST' });
        if (!response.ok) {
          scheduleReconnect();
          return;
        }
        const body = await response.json();
        if (typeof body.ticket !== 'string') return;
        ticket = body.ticket;
      } catch {
        scheduleReconnect();
        return;
      }
      if (!mountedRef.current) return;
      const ws = new WebSocket(url, ['threatdeck', `auth.${ticket}`]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        everConnectedRef.current = true;
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        reconnectAttemptsRef.current = 0;

        // Subscribe to requested channels
        ws.send(
          JSON.stringify({
            action: 'subscribe',
            channels: channelsRef.current,
          }),
        );
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(String(event.data)) as WSMessage;
          setLastMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror, reconnect handled there
      };
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return;
      reconnectAttemptsRef.current++;

      // If WS never connected and we've exceeded max attempts, stop trying
      // (no WS server available — REST polling handles data delivery)
      if (!everConnectedRef.current && reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        return;
      }

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * RECONNECT_MULTIPLIER, MAX_RECONNECT_DELAY);
      reconnectTimerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmount');
        wsRef.current = null;
      }
    };
  }, [url]);

  return { connected, lastMessage, sendMessage };
}

// ─── useRealtimeUpdates Hook ───
// Subscribes to all channels and dispatches incoming data to the correct Zustand stores.

const ALL_CHANNELS: WSChannel[] = [
  'markets',
  'news',
  'crypto',
  'whales',
  'congress',
  'fed',
  'polymarket',
  'alerts',
  'agent',
  // Cyber nudge channels (Phase 4.1) — spread from the shared source of truth
  // so the client list can never drift from the server's ALL_CHANNELS.
  ...CYBER_CHANNELS,
];

export function useRealtimeUpdates(): { connected: boolean } {
  const { connected, lastMessage } = useWebSocket(ALL_CHANNELS);
  const queryClient = useQueryClient();

  // Zustand store actions
  const setIndices = useDataStore((s) => s.setIndices);
  const setSectors = useDataStore((s) => s.setSectors);
  const setCommodities = useDataStore((s) => s.setCommodities);
  const setNews = useDataStore((s) => s.setNews);
  const setCrypto = useDataStore((s) => s.setCrypto);
  const setCongressTrades = useDataStore((s) => s.setCongressTrades);
  const setWhaleTransactions = useDataStore((s) => s.setWhaleTransactions);
  const setPredictionMarkets = useDataStore((s) => s.setPredictionMarkets);
  const setFedData = useDataStore((s) => s.setFedData);
  const addIntelligenceItem = useDataStore((s) => s.addIntelligenceItem);
  const markUpdated = useDataStore((s) => s.markUpdated);

  const addAlert = useAlertsStore((s) => s.addAlert);

  const setStatus = useAgentStore((s) => s.setStatus);
  const appendStreamingText = useAgentStore((s) => s.appendStreamingText);
  const setLatestResponse = useAgentStore((s) => s.setLatestResponse);
  const setRecentBriefs = useAgentStore((s) => s.setRecentBriefs);
  const setPendingApprovals = useAgentStore((s) => s.setPendingApprovals);
  const addToolCall = useAgentStore((s) => s.addToolCall);

  // ─── Channel Dispatchers ───

  function dispatchMarkets(type: string, data: unknown) {
    const d = data as Record<string, unknown>;
    switch (type) {
      case 'indices':
        setIndices(d.indices as Parameters<typeof setIndices>[0]);
        break;
      case 'sectors':
        setSectors(d.sectors as Parameters<typeof setSectors>[0]);
        break;
      case 'commodities':
        setCommodities(d.commodities as Parameters<typeof setCommodities>[0]);
        break;
      case 'full':
        if (d.indices) setIndices(d.indices as Parameters<typeof setIndices>[0]);
        if (d.sectors) setSectors(d.sectors as Parameters<typeof setSectors>[0]);
        if (d.commodities) setCommodities(d.commodities as Parameters<typeof setCommodities>[0]);
        break;
      default:
        break;
    }
    markUpdated('markets');
  }

  function dispatchNews(type: string, data: unknown) {
    const d = data as Record<string, unknown>;
    if (type === 'items' && typeof d.category === 'string') {
      setNews(d.category, d.items as Parameters<typeof setNews>[1]);
    }
    markUpdated(`news_${type}`);
  }

  function dispatchCrypto(_type: string, data: unknown) {
    const d = data as Record<string, unknown>;
    if (d.data) {
      setCrypto(d.data as Parameters<typeof setCrypto>[0]);
    }
    markUpdated('crypto');
  }

  function dispatchWhales(_type: string, data: unknown) {
    const d = data as Record<string, unknown>;
    if (d.data) {
      setWhaleTransactions(d.data as Parameters<typeof setWhaleTransactions>[0]);
    }
    markUpdated('whales');
  }

  function dispatchCongress(_type: string, data: unknown) {
    const d = data as Record<string, unknown>;
    if (d.data) {
      setCongressTrades(d.data as Parameters<typeof setCongressTrades>[0]);
    }
    markUpdated('congress');
  }

  function dispatchFed(_type: string, data: unknown) {
    setFedData(data as Parameters<typeof setFedData>[0]);
    markUpdated('fed');
  }

  function dispatchPolymarket(_type: string, data: unknown) {
    const d = data as Record<string, unknown>;
    if (d.data) {
      setPredictionMarkets(d.data as Parameters<typeof setPredictionMarkets>[0]);
    }
    markUpdated('polymarket');
  }

  function dispatchAlerts(type: string, data: unknown) {
    if (type === 'new') {
      addAlert(data as Parameters<typeof addAlert>[0]);
    } else if (type === 'intelligence') {
      addIntelligenceItem(data as Parameters<typeof addIntelligenceItem>[0]);
    } else if (type === 'outbound:draft_added') {
      // Phase 9.1 — a generator just staged a new draft. Invalidate the
      // Approval Queue so any open AgentDrawer re-fetches within the same
      // tick. Tiny payload — we re-fetch instead of caching the broadcast
      // body since the GET route is the single source of truth.
      void queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
    } else if (type === 'outbound:draft_decided') {
      // Phase 9.1 — another reviewer (or this user in a second drawer)
      // approved or rejected a draft. Optimistically remove it from any
      // local cache so the UI stays in sync without waiting for the next
      // poll tick. Falls back to invalidate so eventual consistency holds.
      const payload = (data ?? {}) as { id?: number };
      const id = typeof payload.id === 'number' ? payload.id : null;
      if (id != null) {
        queryClient.setQueryData<DraftRow[]>(APPROVAL_QUEUE_KEY, (prev) =>
          prev ? prev.filter((d) => d.id !== id) : prev,
        );
      }
      void queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
    }
  }

  // ─── Cyber dispatcher (Phase 4.1) ───
  // The server broadcasts a tiny `{ channel:'cves', type:'refresh' }` nudge
  // when fresh cyber data lands (publisher is Phase 4.2). We don't carry rows
  // over the socket — instead we invalidate the matching TanStack queries so
  // they refetch authoritative data from the API. TanStack v5 invalidate is
  // prefix-matching, so `['cves']` covers every `useCveData` variant key.
  function dispatchCyber(channel: WSChannel, type: string) {
    if (type !== 'refresh') return;
    for (const queryKey of cyberChannelToQueryKeys(channel)) {
      void queryClient.invalidateQueries({ queryKey });
    }
    // Mirror the other dispatchers: stamp a freshness marker so any
    // "last updated" UI reflects the nudge.
    markUpdated(`cyber_${channel}`);
  }

  function dispatchAgent(type: string, data: unknown) {
    const d = data as Record<string, unknown>;
    switch (type) {
      case 'status':
        setStatus(d.status as Parameters<typeof setStatus>[0]);
        break;
      case 'stream':
        appendStreamingText(d.chunk as string);
        break;
      case 'response':
        setLatestResponse(d.response as Parameters<typeof setLatestResponse>[0]);
        break;
      case 'briefs':
        setRecentBriefs(d.briefs as Parameters<typeof setRecentBriefs>[0]);
        break;
      case 'approvals':
        setPendingApprovals(d.approvals as Parameters<typeof setPendingApprovals>[0]);
        break;
      case 'tool_call':
        addToolCall(d.call as Parameters<typeof addToolCall>[0]);
        break;
      default:
        break;
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: dispatch functions are stable refs from Zustand store
  useEffect(() => {
    if (!lastMessage) return;

    const { channel, type, data } = lastMessage;

    switch (channel) {
      case 'markets':
        dispatchMarkets(type, data);
        break;
      case 'news':
        dispatchNews(type, data);
        break;
      case 'crypto':
        dispatchCrypto(type, data);
        break;
      case 'whales':
        dispatchWhales(type, data);
        break;
      case 'congress':
        dispatchCongress(type, data);
        break;
      case 'fed':
        dispatchFed(type, data);
        break;
      case 'polymarket':
        dispatchPolymarket(type, data);
        break;
      case 'alerts':
        dispatchAlerts(type, data);
        break;
      case 'agent':
        dispatchAgent(type, data);
        break;
      // ─── Cyber nudge channels (Phase 4.1) ───
      // Nudge → invalidate → refetch. No payloads carried on these channels.
      case 'cves':
      case 'kev':
      case 'iocs':
      case 'breaches':
      case 'advisories':
        dispatchCyber(channel, type);
        break;
      default:
        break;
    }
    // All dispatch helpers use the stable store setters captured above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage]);

  return { connected };
}

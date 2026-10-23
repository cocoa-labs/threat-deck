'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clearChannel, pushCue } from '@/lib/captions/caption-bridge';
import { DEFAULT_CHANNELS } from '@/lib/data/livestream-channels';

const SUMMARIZE_INTERVAL_MS = 90_000;
const FAST_INTERVAL_MS = 60_000;
const FAST_THRESHOLD = 50;
const DEDUP_SIZE = 10;

interface CaptionBufferOptions {
  hlsRef: React.RefObject<import('hls.js').default | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  channelId: string;
  isPlaying: boolean;
  isHls: boolean;
  enabled: boolean;
}

interface CaptionBufferResult {
  captionAvailable: boolean;
  latestSummary: string | null;
  rawCueCount: number;
  flush: () => void;
}

interface SummarizeResponse {
  summary: string;
  channelId: string;
  windowStart: string;
  windowEnd: string;
  captionCount: number;
  cachedAt: string;
}

function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function useCaptionBuffer(options: CaptionBufferOptions): CaptionBufferResult {
  const { hlsRef, videoRef, channelId, isPlaying, isHls, enabled } = options;

  const [captionAvailable, setCaptionAvailable] = useState(false);
  const [latestSummary, setLatestSummary] = useState<string | null>(null);
  const [rawCueCount, setRawCueCount] = useState(0);

  const bufferRef = useRef<string[]>([]);
  const dedupRef = useRef<string[]>([]);
  const windowStartRef = useRef<string>(new Date().toISOString());
  const isFlushing = useRef(false);

  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;

  const sendSummary = useCallback(async (text: string, cueCount: number) => {
    if (isFlushing.current) return;
    isFlushing.current = true;

    const currentChannelId = channelIdRef.current;
    const channel = DEFAULT_CHANNELS.find((c) => c.id === currentChannelId);
    if (!channel) {
      isFlushing.current = false;
      return;
    }

    const windowEnd = new Date().toISOString();

    try {
      const res = await fetch('/api/data/captions/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: currentChannelId,
          channelLabel: channel.label,
          category: channel.category,
          captionText: text,
          windowStart: windowStartRef.current,
          windowEnd,
          captionCount: cueCount,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as SummarizeResponse;
        setLatestSummary(data.summary);
      }
    } catch {
      // Best-effort summarization
    } finally {
      isFlushing.current = false;
    }
  }, []);

  const flushBuffer = useCallback(() => {
    const buffer = bufferRef.current;
    if (buffer.length === 0) return;

    const text = buffer.join(' ');
    const count = buffer.length;

    bufferRef.current = [];
    windowStartRef.current = new Date().toISOString();

    sendSummary(text, count);
  }, [sendSummary]);

  const addCueText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Dedup check
    if (dedupRef.current.includes(trimmed)) return;

    dedupRef.current.push(trimmed);
    if (dedupRef.current.length > DEDUP_SIZE) {
      dedupRef.current.shift();
    }

    bufferRef.current.push(trimmed);
    setRawCueCount((prev) => prev + 1);
    // Push to bridge for real-time access by stream hooks
    pushCue(channelIdRef.current, trimmed);
  }, []);

  // hls.js wiring (non-Safari)
  useEffect(() => {
    if (!enabled || !isPlaying || !isHls) return;
    if (isSafari()) return;

    const hls = hlsRef.current;
    if (!hls) return;

    let HlsEvents: typeof import('hls.js').default.Events | undefined;

    // We need to dynamically get the Events enum from the hls.js module
    import('hls.js').then((mod) => {
      HlsEvents = mod.default.Events;
      if (!HlsEvents || !hls) return;

      hls.on(HlsEvents.MANIFEST_PARSED, onManifestParsed);
      hls.on(HlsEvents.CUES_PARSED, onCuesParsed);

      // Enable subtitle tracks
      if (hls.subtitleTracks.length > 0) {
        setCaptionAvailable(true);
        hls.subtitleDisplay = false;
        hls.subtitleTrack = 0;
      }
    });

    function onManifestParsed() {
      if (!hls) return;
      if (hls.subtitleTracks.length > 0) {
        setCaptionAvailable(true);
        hls.subtitleDisplay = false;
        hls.subtitleTrack = 0;
      }
    }

    // biome-ignore lint/suspicious/noExplicitAny: hls.js CUES_PARSED event data type varies across versions
    function onCuesParsed(_event: string, data: any) {
      if (!data?.cues) return;
      for (const cue of data.cues) {
        if (cue.text) {
          addCueText(cue.text);
        }
      }
    }

    return () => {
      if (HlsEvents && hls) {
        hls.off(HlsEvents.MANIFEST_PARSED, onManifestParsed);
        hls.off(HlsEvents.CUES_PARSED, onCuesParsed);
      }
    };
  }, [enabled, isPlaying, isHls, hlsRef, addCueText]);

  // Safari native HLS wiring
  useEffect(() => {
    if (!enabled || !isPlaying || !isHls) return;
    if (!isSafari()) return;

    const video = videoRef.current;
    if (!video) return;

    const tracks = video.textTracks;
    const listeners: Array<{ track: TextTrack; handler: () => void }> = [];

    let foundCaptions = false;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track || (track.kind !== 'captions' && track.kind !== 'subtitles')) continue;

      foundCaptions = true;
      track.mode = 'hidden';

      const handler = () => {
        const cues = track.activeCues;
        if (!cues) return;
        for (let j = 0; j < cues.length; j++) {
          const cue = cues[j];
          if (cue && 'text' in cue) {
            addCueText((cue as VTTCue).text);
          }
        }
      };

      track.addEventListener('cuechange', handler);
      listeners.push({ track, handler });
    }

    if (foundCaptions) {
      setCaptionAvailable(true);
    }

    // Also listen for new tracks added
    const onAddTrack = (e: TrackEvent) => {
      const track = e.track;
      if (!track || (track.kind !== 'captions' && track.kind !== 'subtitles')) return;

      setCaptionAvailable(true);
      track.mode = 'hidden';

      const handler = () => {
        const cues = track.activeCues;
        if (!cues) return;
        for (let j = 0; j < cues.length; j++) {
          const cue = cues[j];
          if (cue && 'text' in cue) {
            addCueText((cue as VTTCue).text);
          }
        }
      };

      track.addEventListener('cuechange', handler);
      listeners.push({ track, handler });
    };

    tracks.addEventListener('addtrack', onAddTrack);

    return () => {
      tracks.removeEventListener('addtrack', onAddTrack);
      for (const { track, handler } of listeners) {
        track.removeEventListener('cuechange', handler);
      }
    };
  }, [enabled, isPlaying, isHls, videoRef, addCueText]);

  // Summarization interval
  useEffect(() => {
    if (!enabled || !isPlaying) return;

    const getInterval = () =>
      bufferRef.current.length > FAST_THRESHOLD ? FAST_INTERVAL_MS : SUMMARIZE_INTERVAL_MS;

    const id = setInterval(() => {
      flushBuffer();
    }, getInterval());

    return () => clearInterval(id);
  }, [enabled, isPlaying, flushBuffer]);

  // Channel switch handling
  const prevChannelRef = useRef(channelId);
  useEffect(() => {
    if (prevChannelRef.current === channelId) return;
    prevChannelRef.current = channelId;

    // Flush remaining buffer for previous channel
    if (bufferRef.current.length > 0) {
      const text = bufferRef.current.join(' ');
      const count = bufferRef.current.length;
      sendSummary(text, count);
    }

    // Reset state
    bufferRef.current = [];
    dedupRef.current = [];
    windowStartRef.current = new Date().toISOString();
    setRawCueCount(0);
    setCaptionAvailable(false);
    setLatestSummary(null);
    // Clear bridge buffer for the previous channel
    clearChannel(prevChannelRef.current);
  }, [channelId, sendSummary]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      bufferRef.current = [];
      dedupRef.current = [];
    };
  }, []);

  return {
    captionAvailable,
    latestSummary,
    rawCueCount,
    flush: flushBuffer,
  };
}

'use client';

import { Maximize2, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useSlotId } from '@/components/panels/PanelSlot';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { usePanelsStore } from '@/lib/store/panels-store';
import type { YouTubeVideo } from '@/lib/store/youtube-store';
import { useYouTubeStore } from '@/lib/store/youtube-store';

/* ─── Constants ─── */

const SPEED_OPTIONS = [1, 1.25, 1.5, 1.75, 2] as const;

/* ─── URL Builder (matches LivestreamPanel pattern) ─── */

function buildSearchEmbedUrl(videoId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1', // Required for autoplay; unmuted via postMessage after load
    controls: '1',
    modestbranding: '1',
    rel: '0',
    enablejsapi: '1',
    playsinline: '1',
    ...(origin ? { origin } : {}),
  });
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

/* ─── TrendingGrid ─── */

function TrendingGrid({
  videos,
  onPlay,
}: {
  videos: YouTubeVideo[];
  onPlay: (video: YouTubeVideo) => void;
}) {
  if (videos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
          No trending videos
        </span>
        <span className="text-[9px] font-mono text-[var(--text-dim)]">
          {AGENT_IDENTITY.name} can search YouTube for you
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-2 overflow-y-auto">
      {videos.slice(0, 6).map((video) => (
        <button
          key={video.videoId}
          type="button"
          onClick={() => onPlay(video)}
          className="group relative rounded overflow-hidden bg-black/40 cursor-pointer text-left"
        >
          <div className="relative aspect-video w-full overflow-hidden">
            <Image
              src={video.thumbnailUrl}
              alt=""
              fill
              className="object-cover opacity-70 group-hover:opacity-100"
              sizes="(max-width: 768px) 50vw, 200px"
              unoptimized
            />
            <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-[9px] font-mono px-1 rounded text-white z-10">
              {video.duration}
            </span>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 z-10">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 border border-[var(--crt-glow)]/40">
                <Play size={14} className="text-[var(--crt-glow)] ml-0.5" fill="currentColor" />
              </div>
            </div>
          </div>
          <div className="p-1.5">
            <p className="text-[9px] font-mono text-[var(--text-primary)] line-clamp-2 leading-tight">
              {video.title}
            </p>
            <span className="text-[8px] font-mono text-[var(--text-primary)]/50 mt-0.5 block">
              {video.channelTitle}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ─── PlayerControls ─── */

function PlayerControls({
  isPlaying,
  isMuted,
  playbackSpeed,
  hasNextVideo,
  onTogglePlaying,
  onToggleMute,
  onCycleSpeed,
  onNext,
  onFullscreen,
}: {
  isPlaying: boolean;
  isMuted: boolean;
  playbackSpeed: number;
  hasNextVideo: boolean;
  onTogglePlaying: () => void;
  onToggleMute: () => void;
  onCycleSpeed: () => void;
  onNext: () => void;
  onFullscreen: () => void;
}) {
  return (
    <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 bg-[#080808] border-t border-[var(--border-dim)]">
      <button
        type="button"
        onClick={onTogglePlaying}
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] opacity-70 hover:opacity-100 cursor-pointer"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={13} /> : <Play size={13} />}
      </button>
      {hasNextVideo && (
        <button
          type="button"
          onClick={onNext}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] opacity-70 hover:opacity-100 cursor-pointer"
          aria-label="Next video"
        >
          <SkipForward size={13} />
        </button>
      )}
      <button
        type="button"
        onClick={onToggleMute}
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] opacity-70 hover:opacity-100 cursor-pointer"
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      <button
        type="button"
        onClick={onCycleSpeed}
        className="flex h-6 items-center justify-center rounded px-1.5 font-mono text-[10px] text-[var(--crt-glow)] opacity-70 hover:opacity-100 cursor-pointer"
        aria-label={`Playback speed: ${playbackSpeed}x`}
      >
        {playbackSpeed}x
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onFullscreen}
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] opacity-70 hover:opacity-100 cursor-pointer"
        aria-label="Fullscreen"
      >
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

/* ─── YouTubeSearchPanel ─── */

export function YouTubeSearchPanel() {
  const currentVideo = useYouTubeStore((s) => s.currentVideo);
  const isPlaying = useYouTubeStore((s) => s.isPlaying);
  const isMuted = useYouTubeStore((s) => s.isMuted);
  const playbackSpeed = useYouTubeStore((s) => s.playbackSpeed);
  const queue = useYouTubeStore((s) => s.queue);
  const queueIndex = useYouTubeStore((s) => s.queueIndex);
  const trendingVideos = useYouTubeStore((s) => s.trendingVideos);

  const playVideo = useYouTubeStore((s) => s.playVideo);
  const togglePlaying = useYouTubeStore((s) => s.togglePlaying);
  const toggleMute = useYouTubeStore((s) => s.toggleMute);
  const setSpeed = useYouTubeStore((s) => s.setSpeed);
  const setTrendingVideos = useYouTubeStore((s) => s.setTrendingVideos);
  const advanceQueue = useYouTubeStore((s) => s.advanceQueue);
  const handleVideoBlocked = useYouTubeStore((s) => s.handleVideoBlocked);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Track iframe-internal video navigation (user clicks YouTube's suggested videos)
  // When true, the sync effect skips updating iframeVideoId to prevent iframe reload
  const iframeNavRef = useRef(false);

  // Separate state for the video ID that controls the iframe src.
  // This decouples "which video the iframe loaded" from "what currentVideo says"
  // so that iframe-internal navigation doesn't trigger an iframe reload.
  const [iframeVideoId, setIframeVideoId] = useState<string | null>(currentVideo?.videoId ?? null);

  // Sync external video changes (user/agent plays a new video) to iframe
  useEffect(() => {
    if (iframeNavRef.current) {
      iframeNavRef.current = false;
      return;
    }
    setIframeVideoId(currentVideo?.videoId ?? null);
  }, [currentVideo?.videoId]);

  // Fullscreen detection (same pattern as LivestreamPanel)
  // When fullscreen, layout.tsx renders <Component /> directly (no PanelSlot wrapper),
  // so useSlotId() returns undefined. Detect both cases:
  // 1. We're the fullscreen-rendered instance (slotId undefined, fullscreenSlot set)
  // 2. We're the grid instance whose slot IS fullscreen
  const slotId = useSlotId();
  const fullscreenSlot = usePanelsStore((s) => s.fullscreenSlot);
  const setFullscreenSlot = usePanelsStore((s) => s.setFullscreenSlot);
  // True when the fullscreen overlay is showing a copy of this panel —
  // the grid instance is still mounted but hidden, so suppress its iframe
  // to avoid double audio.
  const isSuppressed = slotId != null && fullscreenSlot === slotId;

  // Build embed URL — changes only when iframeVideoId changes (not on iframe-internal nav)
  const embedUrl = useMemo(
    () => (iframeVideoId ? buildSearchEmbedUrl(iframeVideoId) : null),
    [iframeVideoId],
  );

  // Send command to YouTube iframe via postMessage (same as LivestreamPanel)
  const sendCommand = useCallback((func: string, args?: unknown[]) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args: args ?? [] }),
      'https://www.youtube.com',
    );
  }, []);

  // On iframe load: sync initial state
  const handleIframeLoad = useCallback(() => {
    // Unmute if store says unmuted (embed starts muted for autoplay)
    if (!isMuted) {
      sendCommand('unMute');
    }
    // Set initial playback speed
    if (playbackSpeed !== 1) {
      sendCommand('setPlaybackRate', [playbackSpeed]);
    }
  }, [sendCommand, isMuted, playbackSpeed]);

  // Sync mute changes to iframe via postMessage
  useEffect(() => {
    sendCommand(isMuted ? 'mute' : 'unMute');
  }, [isMuted, sendCommand]);

  // Sync play/pause to iframe via postMessage
  useEffect(() => {
    sendCommand(isPlaying ? 'playVideo' : 'pauseVideo');
  }, [isPlaying, sendCommand]);

  // Sync playback speed to iframe via postMessage
  useEffect(() => {
    sendCommand('setPlaybackRate', [playbackSpeed]);
  }, [playbackSpeed, sendCommand]);

  // Listen for YouTube state change events via postMessage (queue advancement)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      try {
        const data = JSON.parse(event.data);
        // YouTube sends: { event: 'onStateChange', info: stateNumber }
        // info: 0 = ENDED
        if (data.event === 'onStateChange' && data.info === 0) {
          advanceQueue();
        }
      } catch {
        /* not a YouTube message */
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [advanceQueue]);

  // Detect embed-blocked videos via YouTube onError postMessage
  // Error codes 101/150 = "embedding not allowed by owner"
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'onError' && (data.info === 101 || data.info === 150)) {
          handleVideoBlocked();
        }
      } catch {
        /* not a YouTube message */
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleVideoBlocked]);

  // Detect video changes inside YouTube embed (user clicks suggested videos in iframe)
  // YouTube sends infoDelivery/initialDelivery events with videoData when the video changes
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      try {
        const data = JSON.parse(event.data);
        const videoData = data?.info?.videoData;
        if (!videoData?.video_id) return;

        const newVideoId = videoData.video_id as string;
        const current = useYouTubeStore.getState().currentVideo;
        if (current && newVideoId !== current.videoId) {
          // Mark this as an iframe-internal navigation so the sync effect skips
          iframeNavRef.current = true;
          playVideo({
            videoId: newVideoId,
            title: (videoData.title as string) ?? 'YouTube Video',
            channelTitle: (videoData.author as string) ?? '',
            publishedAt: new Date().toISOString(),
            thumbnailUrl: `https://i.ytimg.com/vi/${newVideoId}/hqdefault.jpg`,
            duration: '',
          });
        }
      } catch {
        /* not a YouTube message */
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [playVideo]);

  // Fetch trending on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only fetch
  useEffect(() => {
    if (trendingVideos.length > 0) return;
    fetch('/api/data/youtube/trending')
      .then((res) => res.json())
      .then((data) => {
        if (data.results?.length > 0) {
          setTrendingVideos(data.results);
        }
      })
      .catch(() => {
        /* best-effort */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only fetch
  }, []);

  // Listen for agent commands
  const setSearchResults = useYouTubeStore((s) => s.setSearchResults);
  const setQueue = useYouTubeStore((s) => s.setQueue);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      switch (detail.type) {
        case 'search_results': {
          const autoPlay = detail.autoPlay as YouTubeVideo | undefined;
          const alternatives = (detail.alternatives ?? []) as YouTubeVideo[];
          const query = (detail.query ?? '') as string;
          if (autoPlay) playVideo(autoPlay);
          setSearchResults(autoPlay ? [autoPlay, ...alternatives] : alternatives, query);
          break;
        }
        case 'play': {
          const video = detail.video as YouTubeVideo | undefined;
          if (video) playVideo(video);
          break;
        }
        case 'queue': {
          const videos = (detail.videos ?? []) as YouTubeVideo[];
          if (videos.length > 0) {
            setQueue(videos);
            if (detail.autoPlayFirst && videos[0]) playVideo(videos[0]);
          }
          break;
        }
      }
    };
    window.addEventListener('klammer-youtube-play', handler);
    return () => window.removeEventListener('klammer-youtube-play', handler);
  }, [playVideo, setSearchResults, setQueue]);

  const cycleSpeed = useCallback(() => {
    const currentIdx = SPEED_OPTIONS.indexOf(playbackSpeed as (typeof SPEED_OPTIONS)[number]);
    const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
    const newSpeed = SPEED_OPTIONS[nextIdx]!;
    setSpeed(newSpeed);
    sendCommand('setPlaybackRate', [newSpeed]);
  }, [playbackSpeed, setSpeed, sendCommand]);

  // Fullscreen uses panel-system slot fullscreen (consistent with PanelShell)
  const handleFullscreen = useCallback(() => {
    if (slotId) {
      setFullscreenSlot(fullscreenSlot === slotId ? null : slotId);
    }
  }, [slotId, fullscreenSlot, setFullscreenSlot]);

  const nextVideo =
    queue.length > 0 && queueIndex + 1 < queue.length ? queue[queueIndex + 1] : undefined;

  return (
    <PanelShell id="youtubeSearch" title="YOUTUBE" noPadding>
      <div className="relative flex-1 min-h-0 bg-[#0a0a0a] flex flex-col">
        {currentVideo && embedUrl ? (
          <>
            {/* Video title bar */}
            <div className="flex-shrink-0 px-2 py-1 bg-[#080808] border-b border-[var(--border-dim)]">
              <p className="text-[9px] font-mono text-[var(--text-primary)] truncate">
                {currentVideo.title}
              </p>
              <span className="text-[8px] font-mono text-[var(--text-primary)]/50">
                {currentVideo.channelTitle}
              </span>
            </div>

            {/* Player — plain iframe like LivestreamPanel */}
            {/* When suppressed (grid instance behind fullscreen overlay), hide iframe to prevent double audio */}
            <div ref={wrapperRef} className="relative flex-1 min-h-0 bg-black">
              {!isSuppressed && (
                <iframe
                  ref={iframeRef}
                  src={embedUrl}
                  className="absolute inset-0 h-full w-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  title={currentVideo.title}
                  onLoad={handleIframeLoad}
                />
              )}
            </div>

            {/* Controls */}
            <PlayerControls
              isPlaying={isPlaying}
              isMuted={isMuted}
              playbackSpeed={playbackSpeed}
              hasNextVideo={!!nextVideo}
              onTogglePlaying={togglePlaying}
              onToggleMute={toggleMute}
              onCycleSpeed={cycleSpeed}
              onNext={advanceQueue}
              onFullscreen={handleFullscreen}
            />

            {/* Queue indicator */}
            {nextVideo && (
              <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1 bg-[#060606] border-t border-[var(--border-dim)]">
                <span className="text-[8px] font-mono text-[var(--crt-glow)]/60 uppercase tracking-wider">
                  Up Next
                </span>
                <span className="text-[8px] font-mono text-[var(--text-primary)]/60 truncate flex-1">
                  {nextVideo.title}
                </span>
                <span className="text-[8px] font-mono text-[var(--crt-glow)]/40">
                  {queueIndex + 1}/{queue.length}
                </span>
              </div>
            )}
          </>
        ) : (
          /* Idle: trending grid */
          <TrendingGrid videos={trendingVideos} onPlay={playVideo} />
        )}
      </div>
    </PanelShell>
  );
}

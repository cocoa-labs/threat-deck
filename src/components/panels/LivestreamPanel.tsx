'use client';

import { ExternalLink, Play, Search, Video, Volume2, VolumeX } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useSlotId } from '@/components/panels/PanelSlot';
import {
  type LivestreamChannelConfig,
  type ResolvedChannel,
  resolveChannelConfig,
} from '@/lib/data/livestream-channels';
import { useCaptionBuffer } from '@/lib/hooks/use-caption-buffer';
import { useLivestreamData } from '@/lib/hooks/use-realtime-data';
import { usePanelsStore } from '@/lib/store/panels-store';
import type { YouTubeVideo } from '@/lib/store/youtube-store';
import type { PanelId } from '@/lib/types';

/* ─── Constants ─── */

const CATEGORY_COLORS: Record<LivestreamChannelConfig['category'], string> = {
  finance: 'var(--crt-glow)',
  crypto: 'var(--color-positive)',
  geopolitical: 'var(--color-warning)',
};

/* ─── Channel Store (useSyncExternalStore-based localStorage sync, keyed by instance) ─── */

const channelStoreListeners = new Map<string, Set<() => void>>();

function getListeners(key: string): Set<() => void> {
  let set = channelStoreListeners.get(key);
  if (!set) {
    set = new Set();
    channelStoreListeners.set(key, set);
  }
  return set;
}

function subscribeChannelStore(key: string, callback: () => void) {
  const listeners = getListeners(key);
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function writeChannelStore(key: string, id: string) {
  localStorage.setItem(key, id);
  getListeners(key).forEach((cb) => {
    cb();
  });
}

/* Boolean store helpers (same listener infrastructure as channel store) */

function readBoolStore(key: string, fallback: boolean): boolean {
  const val = localStorage.getItem(key);
  if (val === null) return fallback;
  return val === 'true';
}

function writeBoolStore(key: string, value: boolean) {
  localStorage.setItem(key, String(value));
  getListeners(key).forEach((cb) => {
    cb();
  });
}

/* ─── URL Helpers ─── */

function buildYouTubeEmbedUrl(videoId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    modestbranding: '1',
    rel: '0',
    enablejsapi: '1',
    playsinline: '1',
    ...(origin ? { origin } : {}),
  });
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

/* ─── HLS Player ─── */

function HlsPlayer({
  src,
  muted,
  onMuteToggle,
  videoRef,
  hlsRef,
}: {
  src: string;
  muted: boolean;
  onMuteToggle: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.MutableRefObject<import('hls.js').default | null>;
}) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Safari has native HLS support
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
      return;
    }

    // Dynamically import hls.js for other browsers
    let cancelled = false;
    import('hls.js').then((mod) => {
      if (cancelled) return;
      const Hls = mod.default;
      if (!Hls.isSupported()) return;

      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, videoRef, hlsRef]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted, videoRef]);

  return (
    <div className="absolute inset-0">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        muted={muted}
        playsInline
        autoPlay
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between px-3 py-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-negative)] animate-pulse" />
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-dim)]">
            Live
          </span>
        </div>
        <button
          type="button"
          onClick={onMuteToggle}
          className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-white/10 hover:text-white cursor-pointer"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
    </div>
  );
}

/* ─── YouTube Player ─── */

function YouTubePlayer({
  videoId,
  muted,
  onMuteToggle,
  onStop,
  isLive,
  isFullscreen,
  label,
}: {
  videoId: string;
  muted: boolean;
  onMuteToggle: () => void;
  onStop: () => void;
  isLive: boolean;
  isFullscreen: boolean;
  label: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const embedUrl = useMemo(() => buildYouTubeEmbedUrl(videoId), [videoId]);

  // Send mute/unMute commands via postMessage whenever muted changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func: muted ? 'mute' : 'unMute',
      }),
      'https://www.youtube.com',
    );
  }, [muted]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('button, a')) return;
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onMuteToggle();
      }, 250);
    },
    [onMuteToggle],
  );

  const handleOverlayDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('button, a')) return;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      onStop();
    },
    [onStop],
  );

  return (
    <div className="absolute inset-0">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="absolute inset-0 h-full w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        title={`${label} Livestream`}
      />
      {/* Transparent click overlay — fullscreen only */}
      {isFullscreen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: transparent click overlay for mute toggle
        // biome-ignore lint/a11y/useKeyWithClickEvents: video player click controls, not an interactive widget
        <div
          className="absolute inset-0 z-[5]"
          onClick={handleOverlayClick}
          onDoubleClick={handleOverlayDoubleClick}
        />
      )}
      {/* Bottom bar: gradient + LIVE indicator + mute button */}
      {/* In fullscreen, lift above the command bar (48px) so the button isn't occluded */}
      <div
        className={`pointer-events-none absolute inset-x-0 ${isFullscreen ? 'bottom-12' : 'bottom-0'} z-10 flex items-center justify-between px-3 py-2 bg-gradient-to-t from-black/70 to-transparent`}
      >
        <div className="pointer-events-auto flex items-center gap-1.5">
          {isLive && (
            <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-negative)] animate-pulse" />
          )}
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-dim)]">
            {isLive ? 'Live' : 'Offline'}
          </span>
        </div>
        <button
          type="button"
          onClick={onMuteToggle}
          className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-white/10 hover:text-white cursor-pointer"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
    </div>
  );
}

/* ─── YouTube Search Surface (YT SEARCH channel) ─── */

function formatYouTubeViewCount(count?: string): string | null {
  if (!count) return null;
  const value = Number.parseInt(count, 10);
  if (Number.isNaN(value)) return count;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M views`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K views`;
  return `${value} views`;
}

function formatYouTubePublishedDate(publishedAt: string): string | null {
  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function YouTubeSearchSurface({
  query,
  onQueryChange,
  results,
  loading,
  onSubmit,
  onPick,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: YouTubeVideo[];
  loading: boolean;
  onSubmit: () => void;
  onPick: (v: YouTubeVideo) => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-[#050505]">
      {/* Search input row */}
      <form
        className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--border-dim)] px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Search size={12} className="text-[var(--text-dim)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search YouTube — press Enter"
          className="flex-1 bg-transparent text-[11px] font-mono text-[var(--text-secondary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          aria-label="Search YouTube"
        />
        <button
          type="submit"
          disabled={loading || query.trim().length === 0}
          className="rounded border border-[var(--crt-glow)]/40 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-[var(--crt-glow)] hover:bg-[var(--crt-glow)]/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? '…' : 'Go'}
        </button>
      </form>

      {/* Results / empty state */}
      {results.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <Video size={28} className="text-[var(--text-muted)]" strokeWidth={1} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            {loading ? 'Searching…' : 'Type a query above'}
          </span>
          <span className="text-[9px] font-mono text-[var(--text-dim)]">
            Or ask Max to find a video for you
          </span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {results.map((video) => {
            const viewCount = formatYouTubeViewCount(video.viewCount);
            const publishedDate = formatYouTubePublishedDate(video.publishedAt);
            return (
              <button
                key={video.videoId}
                type="button"
                onClick={() => onPick(video)}
                className="group flex h-20 w-full flex-shrink-0 items-stretch gap-2 overflow-hidden rounded border border-white/5 bg-black/40 p-1.5 text-left cursor-pointer hover:border-[var(--crt-glow)]/35 hover:bg-[var(--crt-glow)]/5"
              >
                <div className="relative h-full w-32 flex-shrink-0 overflow-hidden rounded bg-black">
                  <Image
                    src={video.thumbnailUrl}
                    alt=""
                    fill
                    className="object-cover opacity-75 group-hover:opacity-100"
                    sizes="128px"
                    unoptimized
                  />
                  {video.duration && (
                    <span className="absolute bottom-1 right-1 z-10 rounded bg-black/85 px-1 text-[9px] font-mono text-white">
                      {video.duration}
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-0.5">
                  <p className="line-clamp-2 text-[11px] font-mono leading-snug text-[var(--text-primary)]">
                    {video.title}
                  </p>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] font-mono text-[var(--text-primary)]/55">
                    <span className="truncate text-[var(--text-secondary)]">
                      {video.channelTitle}
                    </span>
                    {viewCount && <span>{viewCount}</span>}
                    {publishedDate && <span>{publishedDate}</span>}
                  </div>
                </div>

                <div className="flex w-8 flex-shrink-0 items-center justify-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--crt-glow)]/30 bg-black/50 text-[var(--crt-glow)] group-hover:border-[var(--crt-glow)]/70 group-hover:bg-black/75">
                    <Play size={12} className="ml-0.5" fill="currentColor" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── LivestreamPanel ─── */

interface LivestreamPanelProps {
  instanceId?: PanelId;
  title?: string;
}

interface LivestreamSurfaceProps {
  instanceId?: string;
  title?: string;
  mode?: 'panel' | 'hero';
  active?: boolean;
  autoplayMuted?: boolean;
}

export function LivestreamSurface({
  instanceId = 'livestream',
  mode = 'panel',
  active = true,
  autoplayMuted = false,
}: LivestreamSurfaceProps) {
  const isHeroMode = mode === 'hero';
  const storageKey = `klammer-${instanceId}-channel`;
  const channels = useMemo(() => resolveChannelConfig(), []);
  const { data: resolvedData, isLoading } = useLivestreamData();
  const resolved = useMemo<Record<string, ResolvedChannel>>(
    () => resolvedData?.data ?? {},
    [resolvedData],
  );

  const defaultChannelId = channels[0]?.id ?? '';

  // Channel selection via useSyncExternalStore (SSR-safe, no setState-in-effect)
  const subscribe = useCallback(
    (cb: () => void) => subscribeChannelStore(storageKey, cb),
    [storageKey],
  );
  const getSnapshot = useCallback(() => {
    const stored = localStorage.getItem(storageKey);
    return stored && channels.some((c) => c.id === stored) ? stored : defaultChannelId;
  }, [channels, defaultChannelId, storageKey]);
  const getServerSnapshot = useCallback(() => defaultChannelId, [defaultChannelId]);
  const activeChannelId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Fullscreen detection
  // When fullscreen, layout.tsx renders <Component /> directly (no PanelSlot wrapper),
  // so useSlotId() returns undefined. Detect both cases:
  // 1. We're the fullscreen-rendered instance (slotId undefined, fullscreenSlot set)
  // 2. We're the grid instance whose slot IS fullscreen
  const slotId = useSlotId();
  const fullscreenSlot = usePanelsStore((s) => s.fullscreenSlot);
  const isPanelFullscreen =
    mode === 'panel' && fullscreenSlot != null && (slotId == null || fullscreenSlot === slotId);
  const isFullscreenSurface = isHeroMode || isPanelFullscreen;
  // True when the fullscreen overlay is showing a copy of this panel —
  // the grid instance is still mounted but hidden, so suppress its player
  // to avoid double audio.
  const isSuppressed = mode === 'panel' ? slotId != null && fullscreenSlot === slotId : !active;

  // Shared playback state via localStorage (same pattern as activeChannelId)
  // so grid ↔ fullscreen instances stay in sync.
  const playKey = `klammer-${instanceId}-playing`;
  const muteKey = `klammer-${instanceId}-muted`;

  const subscribePlaying = useCallback(
    (cb: () => void) => subscribeChannelStore(playKey, cb),
    [playKey],
  );
  const getPlayingSnapshot = useCallback(() => readBoolStore(playKey, false), [playKey]);
  const getPlayingServerSnapshot = useCallback(() => false, []);
  const isPlaying = useSyncExternalStore(
    subscribePlaying,
    getPlayingSnapshot,
    getPlayingServerSnapshot,
  );

  const subscribeMuted = useCallback(
    (cb: () => void) => subscribeChannelStore(muteKey, cb),
    [muteKey],
  );
  const getMutedSnapshot = useCallback(() => readBoolStore(muteKey, true), [muteKey]);
  const getMutedServerSnapshot = useCallback(() => true, []);
  const isMuted = useSyncExternalStore(subscribeMuted, getMutedSnapshot, getMutedServerSnapshot);

  useEffect(() => {
    if (!isHeroMode) return;

    if (!active) {
      writeBoolStore(playKey, false);
      return;
    }

    if (autoplayMuted) {
      writeBoolStore(muteKey, true);
      writeBoolStore(playKey, true);
    }
  }, [active, autoplayMuted, isHeroMode, muteKey, playKey]);

  // Lifted refs for caption buffer access
  const hlsRef = useRef<import('hls.js').default | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeIsHls = channels.find((c) => c.id === activeChannelId)?.type === 'hls';
  const { captionAvailable } = useCaptionBuffer({
    hlsRef,
    videoRef,
    channelId: activeChannelId,
    isPlaying,
    isHls: activeIsHls ?? false,
    enabled: active && isPlaying && (activeIsHls ?? false),
  });

  // Auto-hide tabs in fullscreen or hero mode
  const [tabsVisible, setTabsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleMouseMove = useCallback(() => {
    if (!isFullscreenSurface) return;
    setTabsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setTabsVisible(false), 3000);
  }, [isFullscreenSurface]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset visibility when fullscreen/hero state changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes a user action from the external dashboard store
    setTabsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isFullscreenSurface]);

  // Scrollable tab bar refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? channels[0];

  // Get resolved video ID for a channel
  const getVideoId = useCallback(
    (ch: LivestreamChannelConfig): string | null => {
      const res = resolved[ch.id];
      if (res?.videoId) return res.videoId;
      if (ch.type === 'youtube-video') return ch.source;
      return ch.fallbackVideoId ?? null;
    },
    [resolved],
  );

  // Check if a channel is currently live
  const isChannelLive = useCallback(
    (ch: LivestreamChannelConfig): boolean => {
      if (ch.type === 'hls' || ch.type === 'iframe') return true;
      const res = resolved[ch.id];
      return res?.isLive ?? false;
    },
    [resolved],
  );

  // Update scroll fade indicators
  const updateScrollIndicators = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateScrollIndicators();

    const observer = new ResizeObserver(updateScrollIndicators);
    observer.observe(el);

    return () => observer.disconnect();
  }, [updateScrollIndicators]);

  // Sync shared active-channel key whenever activeChannelId changes (including initial mount)
  // so agent/companion always reads the latest active channel from any livestream instance.
  useEffect(() => {
    if (activeChannelId) {
      localStorage.setItem('klammer-active-channel', activeChannelId);
    }
  }, [activeChannelId]);

  const handleChannelSelect = useCallback(
    (channelId: string, autoPlay = false) => {
      if (channelId === activeChannelId) return;
      writeChannelStore(storageKey, channelId);
      // Write shared key so agent/companion always reads the latest active channel
      localStorage.setItem('klammer-active-channel', channelId);
      window.dispatchEvent(new CustomEvent('active-channel-change', { detail: channelId }));
      writeBoolStore(playKey, autoPlay);
    },
    [activeChannelId, storageKey, playKey],
  );

  // Agent-driven channel switching via CustomEvent
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ channelId: string; panel: string; autoPlay?: boolean }>)
        .detail;
      const targetPanel = detail.panel;
      const isMatch =
        (targetPanel === 'primary' && instanceId === 'livestream') ||
        (targetPanel === 'secondary' && instanceId === 'livestream2');
      if (isMatch) {
        handleChannelSelect(detail.channelId, detail.autoPlay ?? false);
      }
    };
    window.addEventListener('klammer-channel-switch', handler);
    return () => window.removeEventListener('klammer-channel-switch', handler);
  }, [instanceId, handleChannelSelect]);

  /* ─── YT SEARCH local state (only relevant when active channel is 'youtube-search') ─── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<YouTubeVideo[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSelectedVideo, setSearchSelectedVideo] = useState<{
    videoId: string;
    title: string;
  } | null>(null);

  // Drop the in-flight YT video whenever the user leaves the YT SEARCH channel.
  // (Search query + results stay so flipping back restores the last results.)
  useEffect(() => {
    if (activeChannelId !== 'youtube-search') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes a user action from the external dashboard store
      setSearchSelectedVideo(null);
    }
  }, [activeChannelId]);

  const performYouTubeSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearchLoading(true);
    try {
      const res = await fetch(
        `/api/data/youtube/search?q=${encodeURIComponent(trimmed)}&maxResults=12`,
      );
      if (!res.ok) {
        setSearchResults([]);
        return;
      }
      const json = (await res.json()) as { results?: YouTubeVideo[] };
      setSearchResults(json.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const playSearchResult = useCallback(
    (video: YouTubeVideo) => {
      setSearchSelectedVideo({ videoId: video.videoId, title: video.title });
      writeBoolStore(playKey, true);
    },
    [playKey],
  );

  /* ─── Hero-mode listeners ─── */
  // Smart routing in use-agent-stream / use-companion-stream fires these only
  // when `heroTab === 'live'`. We listen unconditionally in hero mode; the
  // routing layer is responsible for picking the right surface.
  useEffect(() => {
    if (!isHeroMode) return;

    const channelHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ channelId: string; autoPlay?: boolean }>).detail;
      handleChannelSelect(detail.channelId, detail.autoPlay ?? true);
    };

    const youtubeHandler = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          type: 'search_results' | 'play' | 'queue';
          video?: { videoId: string; title?: string };
          autoPlay?: { videoId: string; title?: string };
          videos?: Array<{ videoId: string; title?: string }>;
        }>
      ).detail;

      // Pick the single video to play across all three command shapes.
      let pick: { videoId: string; title?: string } | null = null;
      if (detail.type === 'play' && detail.video) pick = detail.video;
      else if (detail.type === 'search_results' && detail.autoPlay) pick = detail.autoPlay;
      else if (detail.type === 'queue' && detail.videos && detail.videos.length > 0)
        pick = detail.videos[0] ?? null;

      if (!pick) return;

      // Land in the YT SEARCH channel and start playing the agent's pick.
      handleChannelSelect('youtube-search', true);
      setSearchSelectedVideo({
        videoId: pick.videoId,
        title: pick.title ?? pick.videoId,
      });
    };

    window.addEventListener('klammer-hero-channel-switch', channelHandler);
    window.addEventListener('klammer-hero-youtube-play', youtubeHandler);
    return () => {
      window.removeEventListener('klammer-hero-channel-switch', channelHandler);
      window.removeEventListener('klammer-hero-youtube-play', youtubeHandler);
    };
  }, [isHeroMode, handleChannelSelect]);

  const handlePlay = useCallback(() => {
    writeBoolStore(playKey, true);
  }, [playKey]);

  const toggleMute = useCallback(() => {
    writeBoolStore(muteKey, !isMuted);
  }, [muteKey, isMuted]);

  // Fullscreen click controls: single-click = mute toggle, double-click = stop video
  // Only active when fullscreen + playing. Clicks on buttons/links are ignored.
  // YouTube iframes capture their own clicks (cross-origin), so this only affects HLS.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleVideoClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isFullscreenSurface || !isPlaying) return;
      if ((e.target as HTMLElement).closest('button, a')) return;
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        writeBoolStore(muteKey, !isMuted);
      }, 250);
    },
    [isFullscreenSurface, isPlaying, muteKey, isMuted],
  );

  const handleVideoDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isFullscreenSurface || !isPlaying) return;
      if ((e.target as HTMLElement).closest('button, a')) return;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      writeBoolStore(playKey, false);
    },
    [isFullscreenSurface, isPlaying, playKey],
  );

  // No channels available
  if (!activeChannel) {
    return (
      <div className="relative h-full w-full flex-1 min-h-0 min-w-0 bg-[#050505]">
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <Video size={32} className="text-[var(--text-muted)]" strokeWidth={1} />
          <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">
            No Active Feed
          </span>
          <span className="text-[9px] font-mono text-[var(--text-dim)]">
            Set YOUTUBE_API_KEY to auto-resolve live streams
          </span>
        </div>
      </div>
    );
  }

  const videoId = getVideoId(activeChannel);
  const isLive = isChannelLive(activeChannel);
  const isHls = activeChannel.type === 'hls';
  const isYTSearch = activeChannel.type === 'youtube-search';
  const isYouTube = !!videoId && !isHls && !isYTSearch;
  const thumbnailUrl = isYouTube
    ? (resolved[activeChannel.id]?.thumbnailUrl ??
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`)
    : null;

  // NOW indicator: shown above the channel strip when the YT SEARCH surface
  // has a video playing (whether the user picked it or Max sent it). Disappears
  // when a curated channel is active.
  const nowPlayingTitle = isYTSearch && searchSelectedVideo ? searchSelectedVideo.title : null;

  const tabBarElement =
    channels.length > 1 ? (
      <div
        className="relative flex-shrink-0 bg-[#080808]"
        style={{
          borderTop: isFullscreenSurface ? 'none' : '1px solid var(--border-dim)',
          borderBottom: isFullscreenSurface ? '1px solid var(--border-dim)' : 'none',
          opacity: isFullscreenSurface && !tabsVisible ? 0 : 1,
          pointerEvents: isFullscreenSurface && !tabsVisible ? 'none' : 'auto',
          transition: 'opacity 300ms ease',
        }}
      >
        {/* NOW indicator — shown when YT SEARCH is playing an arbitrary video */}
        {nowPlayingTitle && (
          <div className="flex items-center gap-2 border-b border-[var(--border-dim)] bg-black/40 px-3 py-1">
            <span className="text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Now
            </span>
            <span className="truncate text-[10px] font-mono text-[var(--text-secondary)]">
              {nowPlayingTitle}
            </span>
          </div>
        )}
        {/* Left fade indicator */}
        {canScrollLeft && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10 bg-gradient-to-r from-[#080808] to-transparent" />
        )}
        {/* Right fade indicator */}
        {canScrollRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 z-10 bg-gradient-to-l from-[#080808] to-transparent" />
        )}

        <div
          ref={scrollRef}
          className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
          }}
          onScroll={updateScrollIndicators}
        >
          {channels.map((ch) => {
            const isActive = ch.id === activeChannelId;
            const color = CATEGORY_COLORS[ch.category];
            const live = isChannelLive(ch);
            const hasVideo = !!getVideoId(ch) || ch.type === 'hls';

            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => handleChannelSelect(ch.id)}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-wider cursor-pointer"
                style={{
                  scrollSnapAlign: 'start',
                  border: `1px solid ${isActive ? color : 'transparent'}`,
                  color: isActive ? color : hasVideo ? 'var(--text-dim)' : 'var(--text-muted)',
                  backgroundColor: isActive ? 'rgba(0,170,255,0.06)' : 'transparent',
                  boxShadow: isActive ? `0 0 6px ${color}33` : 'none',
                  opacity: hasVideo ? 1 : 0.5,
                }}
                aria-label={`Switch to ${ch.label}${live ? ' (live)' : !hasVideo ? ' (offline)' : ''}`}
                aria-pressed={isActive}
              >
                {/* Live indicator dot */}
                {live && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: 'var(--color-negative)' }}
                  />
                )}
                <span className={isLoading ? 'animate-pulse' : ''}>{ch.label}</span>
              </button>
            );
          })}
          {/* CC badge when captions are available */}
          {captionAvailable && (
            <span className="flex-shrink-0 text-[8px] font-mono uppercase px-1 py-0.5 rounded bg-[var(--crt-glow)]/10 text-[var(--crt-glow)] border border-[var(--crt-glow)]/20">
              CC
            </span>
          )}
        </div>
      </div>
    ) : null;

  return (
    <div className="relative flex h-full w-full flex-1 min-h-0 min-w-0 flex-col bg-[#050505]">
      {/* Tab bar: TOP position in fullscreen and hero mode */}
      {isFullscreenSurface && tabBarElement}

      {/* Video area */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: passive mouse/click tracking for fullscreen controls */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: video player click controls, not an interactive widget */}
      <div
        className="relative flex-1 min-h-0"
        onMouseMove={handleMouseMove}
        onClick={handleVideoClick}
        onDoubleClick={handleVideoDoubleClick}
      >
        {isPlaying && !isSuppressed && isHls ? (
          <HlsPlayer
            src={activeChannel.source}
            muted={isMuted}
            onMuteToggle={toggleMute}
            videoRef={videoRef}
            hlsRef={hlsRef}
          />
        ) : isPlaying && !isSuppressed && isYouTube && videoId ? (
          /* YouTube player — loaded only after user clicks play */
          <YouTubePlayer
            videoId={videoId}
            muted={isMuted}
            onMuteToggle={toggleMute}
            onStop={() => writeBoolStore(playKey, false)}
            isLive={isLive}
            isFullscreen={isFullscreenSurface}
            label={activeChannel.label}
          />
        ) : isYTSearch && !isSuppressed && isPlaying && searchSelectedVideo ? (
          /* YT SEARCH — playing a picked / agent-pushed video */
          <YouTubePlayer
            videoId={searchSelectedVideo.videoId}
            muted={isMuted}
            onMuteToggle={toggleMute}
            onStop={() => {
              setSearchSelectedVideo(null);
              writeBoolStore(playKey, false);
            }}
            isLive={false}
            isFullscreen={isFullscreenSurface}
            label={searchSelectedVideo.title}
          />
        ) : isYTSearch && !isSuppressed ? (
          /* YT SEARCH — search input + results list */
          <YouTubeSearchSurface
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults}
            loading={searchLoading}
            onSubmit={() => performYouTubeSearch(searchQuery)}
            onPick={playSearchResult}
          />
        ) : thumbnailUrl ? (
          /* Facade: YouTube thumbnail + play button */
          <button
            type="button"
            onClick={handlePlay}
            className="absolute inset-0 h-full w-full cursor-pointer group bg-[#050505]"
            aria-label={`Play ${activeChannel.label}`}
          >
            <Image
              src={thumbnailUrl}
              alt={activeChannel.label}
              fill
              className="object-cover opacity-70 group-hover:opacity-90"
              sizes="(max-width: 768px) 100vw, 50vw"
              unoptimized
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 border border-[var(--crt-glow)]/40 group-hover:border-[var(--crt-glow)] group-hover:bg-black/80">
                <Play size={24} className="text-[var(--crt-glow)] ml-0.5" fill="currentColor" />
              </div>
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-dim)] group-hover:text-[var(--text-secondary)]">
                {isLive ? 'Click to play' : 'Last stream (offline)'}
              </span>
            </div>
            {/* Watch on YouTube fallback link */}
            {videoId && (
              <div className="absolute bottom-10 right-3 z-10">
                <a
                  href={`https://www.youtube.com/watch?v=${videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider text-[var(--text-dim)] hover:text-[var(--crt-glow)]"
                >
                  <ExternalLink size={9} />
                  Watch on YouTube
                </a>
              </div>
            )}
          </button>
        ) : isHls ? (
          /* HLS facade — play button without thumbnail */
          <button
            type="button"
            onClick={handlePlay}
            className="absolute inset-0 h-full w-full cursor-pointer group bg-[#050505]"
            aria-label={`Play ${activeChannel.label}`}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 border border-[var(--crt-glow)]/40 group-hover:border-[var(--crt-glow)] group-hover:bg-black/80">
                <Play size={24} className="text-[var(--crt-glow)] ml-0.5" fill="currentColor" />
              </div>
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-dim)] group-hover:text-[var(--text-secondary)]">
                Click to play
              </span>
            </div>
          </button>
        ) : (
          /* No video available — clean offline state with channel link */
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Video size={24} className="text-[var(--text-muted)]" strokeWidth={1} />
            <span className="text-[9px] font-mono text-[var(--text-muted)]">
              {isLive ? 'Unsupported feed' : 'Channel offline'}
            </span>
            {activeChannel.type === 'youtube-channel' && (
              <a
                href={`https://www.youtube.com/channel/${activeChannel.source}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider text-[var(--text-dim)] hover:text-[var(--crt-glow)]"
              >
                <ExternalLink size={9} />
                Watch on YouTube
              </a>
            )}
          </div>
        )}

        {/* Bottom gradient + LIVE indicator (YouTube facade only — YouTubePlayer has its own when playing) */}
        {!isHls && !isPlaying && thumbnailUrl && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between px-3 py-2 bg-gradient-to-t from-black/70 to-transparent">
            <div className="pointer-events-auto flex items-center gap-1.5">
              {isLive && (
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-negative)] animate-pulse" />
              )}
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-dim)]">
                {isLive ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tab bar: BOTTOM position in grid view */}
      {!isFullscreenSurface && tabBarElement}
    </div>
  );
}

export function LivestreamPanel({
  instanceId = 'livestream',
  title = 'LIVESTREAM',
}: LivestreamPanelProps) {
  return (
    <PanelShell id={instanceId} title={title} noPadding>
      <LivestreamSurface instanceId={instanceId} title={title} mode="panel" />
    </PanelShell>
  );
}

export function LivestreamPanel2() {
  return <LivestreamPanel instanceId="livestream2" title="LIVESTREAM 2" />;
}

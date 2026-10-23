'use client';

import Image from 'next/image';
import type { YouTubeVideo } from '@/lib/store/youtube-store';
import { useYouTubeStore } from '@/lib/store/youtube-store';

interface YouTubeSearchResultCardProps {
  autoPlay: YouTubeVideo;
  alternatives: YouTubeVideo[];
  query: string;
}

export function YouTubeSearchResultCard({
  autoPlay,
  alternatives,
  query,
}: YouTubeSearchResultCardProps) {
  const playVideo = useYouTubeStore((s) => s.playVideo);
  const blockedVideoIds = useYouTubeStore((s) => s.blockedVideoIds);

  return (
    <div className="mt-2 rounded border border-[var(--crt-glow)]/20 bg-black/40 p-3">
      <div className="mb-2 text-xs font-mono text-[var(--crt-glow)]/60 uppercase tracking-wider">
        YouTube Results: &quot;{query}&quot;
      </div>

      {/* Now Playing */}
      <VideoCard
        video={autoPlay}
        index={1}
        isPlaying
        isBlocked={blockedVideoIds.has(autoPlay.videoId)}
        onClick={() => playVideo(autoPlay)}
      />

      {/* Alternatives */}
      {alternatives.map((video, i) => (
        <VideoCard
          key={video.videoId}
          video={video}
          index={i + 2}
          isBlocked={blockedVideoIds.has(video.videoId)}
          onClick={() => playVideo(video)}
        />
      ))}
    </div>
  );
}

function VideoCard({
  video,
  index,
  isPlaying,
  isBlocked,
  onClick,
}: {
  video: YouTubeVideo;
  index: number;
  isPlaying?: boolean;
  isBlocked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={isBlocked ? undefined : onClick}
      disabled={isBlocked}
      className={`flex w-full gap-2 rounded p-1.5 text-left ${
        isBlocked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5 cursor-pointer'
      } ${
        isPlaying && !isBlocked ? 'bg-[var(--crt-glow)]/5 border border-[var(--crt-glow)]/20' : ''
      }`}
    >
      {/* Thumbnail */}
      <div className="relative flex-shrink-0 w-[120px] h-[68px] rounded overflow-hidden bg-black">
        <Image
          src={video.thumbnailUrl}
          alt=""
          fill
          className="object-cover"
          sizes="120px"
          unoptimized
        />
        <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-[10px] font-mono px-1 rounded text-white z-10">
          {isBlocked ? 'BLOCKED' : video.duration}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-[var(--crt-glow)]/50 text-xs font-mono">#{index}</span>
          {isBlocked && (
            <span className="text-[10px] font-mono text-[var(--color-negative)] uppercase">
              Embed Blocked
            </span>
          )}
          {isPlaying && !isBlocked && (
            <span className="text-[10px] font-mono text-[var(--color-positive)] uppercase">
              Now Playing
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-[var(--text-primary)] line-clamp-2 leading-tight">
          {video.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-[var(--text-primary)]/50">
          <span>{video.channelTitle}</span>
          {video.viewCount && <span>{formatViewCount(video.viewCount)} views</span>}
        </div>
      </div>
    </button>
  );
}

function formatViewCount(count: string): string {
  const n = parseInt(count, 10);
  if (Number.isNaN(n)) return count;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

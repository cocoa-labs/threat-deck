import { create } from 'zustand';

export interface YouTubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId?: string;
  publishedAt: string;
  thumbnailUrl: string;
  description?: string;
  duration: string;
  viewCount?: string;
  likeCount?: string;
}

interface YouTubeState {
  // Current playback
  currentVideo: YouTubeVideo | null;
  isPlaying: boolean;
  isMuted: boolean;
  playbackSpeed: number;

  // Search results
  searchResults: YouTubeVideo[];
  lastQuery: string | null;

  // Queue
  queue: YouTubeVideo[];
  queueIndex: number;

  // Trending (idle state)
  trendingVideos: YouTubeVideo[];

  // Blocked videos (embed-restricted channels)
  blockedVideoIds: Set<string>;

  // Actions
  playVideo: (video: YouTubeVideo) => void;
  setSearchResults: (results: YouTubeVideo[], query: string) => void;
  setQueue: (videos: YouTubeVideo[]) => void;
  advanceQueue: () => void;
  handleVideoBlocked: () => void;
  setSpeed: (speed: number) => void;
  toggleMute: () => void;
  togglePlaying: () => void;
  setTrendingVideos: (videos: YouTubeVideo[]) => void;
  clear: () => void;
}

export const useYouTubeStore = create<YouTubeState>((set, get) => ({
  currentVideo: null,
  isPlaying: false,
  isMuted: false,
  playbackSpeed: 1.5,
  searchResults: [],
  lastQuery: null,
  queue: [],
  queueIndex: 0,
  trendingVideos: [],
  blockedVideoIds: new Set(),

  playVideo: (video) =>
    set({
      currentVideo: video,
      isPlaying: true,
    }),

  setSearchResults: (results, query) =>
    set({
      searchResults: results,
      lastQuery: query,
    }),

  setQueue: (videos) =>
    set({
      queue: videos,
      queueIndex: 0,
    }),

  advanceQueue: () => {
    const { queue, queueIndex } = get();
    const nextIndex = queueIndex + 1;
    if (nextIndex < queue.length) {
      const nextVideo = queue[nextIndex];
      if (nextVideo) {
        set({
          currentVideo: nextVideo,
          queueIndex: nextIndex,
          isPlaying: true,
        });
      }
    } else {
      set({
        currentVideo: null,
        isPlaying: false,
        queue: [],
        queueIndex: 0,
      });
    }
  },

  handleVideoBlocked: () => {
    const { currentVideo, searchResults, queue, queueIndex, blockedVideoIds } = get();
    if (!currentVideo) return;

    // Mark this video as blocked
    const newBlocked = new Set(blockedVideoIds);
    newBlocked.add(currentVideo.videoId);

    // Try queue first
    if (queue.length > 0) {
      for (let i = queueIndex + 1; i < queue.length; i++) {
        const next = queue[i];
        if (next && !newBlocked.has(next.videoId)) {
          set({
            currentVideo: next,
            queueIndex: i,
            isPlaying: true,
            blockedVideoIds: newBlocked,
          });
          return;
        }
      }
    }

    // Fallback: try next unblocked search result
    const currentIdx = searchResults.findIndex((v) => v.videoId === currentVideo.videoId);
    for (let i = currentIdx + 1; i < searchResults.length; i++) {
      const next = searchResults[i];
      if (next && !newBlocked.has(next.videoId)) {
        set({
          currentVideo: next,
          isPlaying: true,
          blockedVideoIds: newBlocked,
        });
        return;
      }
    }

    // Also try results before current (wrap around)
    for (let i = 0; i < currentIdx; i++) {
      const next = searchResults[i];
      if (next && !newBlocked.has(next.videoId)) {
        set({
          currentVideo: next,
          isPlaying: true,
          blockedVideoIds: newBlocked,
        });
        return;
      }
    }

    // All blocked — clear playback
    set({
      currentVideo: null,
      isPlaying: false,
      blockedVideoIds: newBlocked,
    });
  },

  setSpeed: (speed) => set({ playbackSpeed: speed }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setTrendingVideos: (videos) => set({ trendingVideos: videos }),
  clear: () =>
    set({
      currentVideo: null,
      isPlaying: false,
      searchResults: [],
      lastQuery: null,
      queue: [],
      queueIndex: 0,
    }),
}));

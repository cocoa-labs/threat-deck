import { create } from 'zustand';

export interface CompanionContextUpdate {
  id: string;
  type: 'cc_digest' | 'headline' | 'market_link' | 'cross_reference' | 'topic_change';
  title: string;
  content: string;
  source?: string;
  url?: string;
  timestamp: string;
  severity?: 'info' | 'medium' | 'high' | 'critical';
}

export interface CompanionTickerItem {
  id: string;
  text: string;
  source: string;
  type: 'headline' | 'market' | 'insight';
  url?: string;
}

export interface ChannelSwitchData {
  channelId: string;
  channelLabel: string;
  category: 'finance' | 'crypto' | 'geopolitical';
  nowPlaying: {
    videoTitle: string | null;
    description: string | null;
    channelHeadlines: string[];
    livePage: { headlines: string[]; liveUpdates: string[] } | null;
    ccSummary: string | null;
  } | null;
}

export interface YouTubeVideoContext {
  videoId: string;
  title: string;
  channelTitle: string;
  description?: string;
  tags?: string[];
}

export interface CompanionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isError?: boolean;
  channelSwitch?: ChannelSwitchData;
  youtubeVideo?: YouTubeVideoContext;
  youtubeResults?: {
    autoPlay: import('@/lib/store/youtube-store').YouTubeVideo | null;
    alternatives: import('@/lib/store/youtube-store').YouTubeVideo[];
    query: string;
  };
  generatedImages?: import('@/lib/store/agent-store').GeneratedImageAttachment[];
  generatedVideos?: import('@/lib/store/agent-store').GeneratedVideoAttachment[];
}

export interface CompanionToastItem {
  id: string;
  title: string;
  content: string;
  severity: 'info' | 'medium' | 'high' | 'critical';
  timestamp: string;
  dismissed: boolean;
  url?: string;
}

const MAX_CONTEXT_UPDATES = 50;
const MAX_MESSAGES = 100;
const MAX_TOASTS = 5;

interface CompanionState {
  // Core state
  isActive: boolean;
  engagementLevel: 'ambient' | 'engaged' | 'full';
  sidebarOpen: boolean;
  activeChannelId: string | null;

  // Content
  contextUpdates: CompanionContextUpdate[];
  tickerItems: CompanionTickerItem[];
  companionMessages: CompanionMessage[];
  companionStreamingText: string;
  companionToasts: CompanionToastItem[];
  isCompanionStreaming: boolean;

  // Actions
  activate: (channelId: string) => void;
  deactivate: () => void;
  setEngagementLevel: (level: 'ambient' | 'engaged' | 'full') => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  addContextUpdate: (update: CompanionContextUpdate) => void;
  setTickerItems: (items: CompanionTickerItem[]) => void;
  addCompanionMessage: (message: CompanionMessage) => void;
  setCompanionStreamingText: (text: string) => void;
  appendCompanionStreamingText: (text: string) => void;
  setIsCompanionStreaming: (streaming: boolean) => void;
  addCompanionToast: (toast: CompanionToastItem) => void;
  dismissCompanionToast: (id: string) => void;
  clearCompanionMessages: () => void;
}

export const useCompanionStore = create<CompanionState>((set) => ({
  // Initial state
  isActive: false,
  engagementLevel: 'ambient',
  sidebarOpen: false,
  activeChannelId: null,
  contextUpdates: [],
  tickerItems: [],
  companionMessages: [],
  companionStreamingText: '',
  companionToasts: [],
  isCompanionStreaming: false,

  // Actions
  activate: (channelId) =>
    set({ isActive: true, activeChannelId: channelId, engagementLevel: 'ambient' }),

  deactivate: () => set({ isActive: false, sidebarOpen: false, engagementLevel: 'ambient' }),

  setEngagementLevel: (level) => set({ engagementLevel: level }),

  toggleSidebar: () =>
    set((s) => ({
      sidebarOpen: !s.sidebarOpen,
      engagementLevel: !s.sidebarOpen ? 'engaged' : s.engagementLevel,
    })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  addContextUpdate: (update) =>
    set((s) => ({
      contextUpdates: [update, ...s.contextUpdates].slice(0, MAX_CONTEXT_UPDATES),
    })),

  setTickerItems: (items) => set({ tickerItems: items }),

  addCompanionMessage: (message) =>
    set((s) => ({
      companionMessages: [...s.companionMessages, message].slice(-MAX_MESSAGES),
    })),

  setCompanionStreamingText: (text) => set({ companionStreamingText: text }),

  appendCompanionStreamingText: (text) =>
    set((s) => ({ companionStreamingText: s.companionStreamingText + text })),

  setIsCompanionStreaming: (streaming) => set({ isCompanionStreaming: streaming }),

  addCompanionToast: (toast) =>
    set((s) => ({
      companionToasts: [...s.companionToasts.filter((t) => !t.dismissed), toast].slice(-MAX_TOASTS),
    })),

  dismissCompanionToast: (id) =>
    set((s) => ({
      companionToasts: s.companionToasts.map((t) => (t.id === id ? { ...t, dismissed: true } : t)),
    })),

  clearCompanionMessages: () => set({ companionMessages: [], companionStreamingText: '' }),
}));

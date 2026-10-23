import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentAttachmentSummary } from '@/lib/agent/attachments/types';
import type { AgentMode } from '@/lib/agent/mode-config';
import type {
  AgentResponse,
  AgentStatus,
  ApprovalRequest,
  BreakingAlertThreshold,
  BriefSummary,
  Conversation,
  Severity,
  ToolCall,
} from '@/lib/types';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  origin?: 'agent' | 'companion';
  channelSwitch?: import('@/lib/store/companion-store').ChannelSwitchData;
  youtubeResults?: {
    autoPlay: import('@/lib/store/youtube-store').YouTubeVideo | null;
    alternatives: import('@/lib/store/youtube-store').YouTubeVideo[];
    query: string;
  };
  responseMode?: 'concise' | 'standard';
  /**
   * Three-mode posture the agent ran in for this response (Phase 14).
   * Optional for graceful migration of pre-Phase-14 persisted messages —
   * historical messages without this field render no mode chip.
   */
  agentMode?: AgentMode;
  expansion?: string;
  isExpanding?: boolean;
  citationRepairs?: number;
  generatedImages?: GeneratedImageAttachment[];
  generatedVideos?: GeneratedVideoAttachment[];
  sourceContext?: VisualBriefSourceContext;
  attachments?: AgentAttachmentSummary[];
  /** Set once this message's content was posted to X. Persisted (survives reload). */
  postedToX?: { tweetId: string; tweetUrl: string; postedAt: number };
  /** Set once this message's content was emailed out. Persisted. */
  emailedAt?: number;
  emailRecipient?: string;
}

export interface AgentAttachmentUiState extends AgentAttachmentSummary {
  uploadProgress?: number;
  localPreviewUrl?: string;
  uiStatusLabel?: string;
}

export interface GeneratedImageAttachment {
  generatedMediaId: string;
  /** Absent while pending or when generation failed. */
  blobUrl?: string;
  styleTag?: string;
  status?: 'pending' | 'ready' | 'failed';
  pollUrl?: string;
  providerJobId?: string;
  providerStatus?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface GeneratedVideoAttachment {
  generatedMediaId: string;
  blobUrl?: string;
  styleTag?: string;
  status?: 'pending' | 'ready' | 'failed';
  pollUrl?: string;
  providerJobId?: string;
  providerStatus?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface AutonomousResultItem {
  id: string;
  triggerSource: string;
  task: string;
  headline: string;
  severity: Severity;
  text: string;
  timestamp: number;
  dismissed: boolean;
  eventData?: Record<string, unknown>;
}

/**
 * A background "Post to X" job, surfaced as a dismissable toast while it runs in
 * the background (server-side, reload-safe). Ephemeral (not persisted) — on
 * reload the drawer re-fetches active jobs from /api/outbound/x/jobs.
 */
export interface XPostJobItem {
  jobToken: string;
  status: 'queued' | 'generating_image' | 'posting' | 'posted' | 'failed' | 'needs_reconnect';
  pollUrl: string;
  /** Links the job back to its originating Max message so a generate-image post can seed the image inline. */
  messageTimestamp?: number;
  publishMode: 'single' | 'two_post';
  primaryTextPreview: string;
  tweetIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  dismissed: boolean;
}

/** Terminal X-post job statuses — the job is done; the client poller stops advancing it. */
export function isTerminalXPostStatus(status: XPostJobItem['status']): boolean {
  return status === 'posted' || status === 'failed' || status === 'needs_reconnect';
}

interface AgentState {
  // Status
  status: AgentStatus;
  currentTask: string | null;

  // Streaming
  streamingText: string;
  isStreaming: boolean;

  // Results
  latestResponse: AgentResponse | null;
  recentBriefs: BriefSummary[];
  toolCallLog: ToolCall[];

  // Approvals
  pendingApprovals: ApprovalRequest[];

  // Command bar
  commandHistory: string[];
  activeAttachments: AgentAttachmentUiState[];

  // Conversation
  messages: ConversationMessage[];
  drawerOpen: boolean;
  drawerFullscreen: boolean;
  /** ISO timestamp of the last drawer close — anchor for the "since last visit" delta. */
  lastSeenAt: string | null;

  // Prefill
  prefillText: string | null;

  // Response mode (verbosity — separate concept from agent posture)
  responseMode: 'concise' | 'standard';
  autoSend: boolean;

  // Three-mode posture state (Phase 14)
  // lockedMode === null means AUTO: the agent's in-prompt auto-promotion drives
  // mode selection. When non-null, the server honors the lock as a *floor* —
  // critical-signal escalations may still lift it for a single turn.
  lockedMode: AgentMode | null;
  // detectedMode reflects which mode the most recent response actually used,
  // parsed from the [[MODE:...]] marker the model emits at the start of every
  // response. Drives the passive-indicator state on the pill row.
  detectedMode: AgentMode;

  // Conversation grouping
  conversations: Conversation[];
  activeConversationId: string | null;

  // Autonomous results
  autonomousResults: AutonomousResultItem[];
  xPostJobs: XPostJobItem[];
  // Whether autonomous agent alerts (toasts) are allowed to fire. Persisted so
  // the user's mute choice survives reloads; gated at the fireEvent choke point
  // in use-activation-events. Toggled from the left-rail bell button.
  autonomousAlertsEnabled: boolean;
  // How loud the hero breaking-alert overlay is allowed to be. Persisted
  // alongside the mute toggle; set in SettingsDialog, read by
  // use-breaking-alerts. Defaults to 'critical' — the red box is an interrupt,
  // not a feed.
  breakingAlertThreshold: BreakingAlertThreshold;

  // Actions
  setStatus: (status: AgentStatus) => void;
  setCurrentTask: (task: string | null) => void;
  appendStreamingText: (chunk: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  clearStreamingText: () => void;
  setLatestResponse: (
    response: AgentResponse,
    channelSwitch?: import('@/lib/store/companion-store').ChannelSwitchData,
    citationRepairs?: number,
    youtubeResults?: ConversationMessage['youtubeResults'],
    sourceContext?: ConversationMessage['sourceContext'],
    generatedMedia?: {
      images?: GeneratedImageAttachment[];
      videos?: GeneratedVideoAttachment[];
    },
    sourceAttachments?: AgentAttachmentSummary[],
    agentMode?: AgentMode,
  ) => void;
  setRecentBriefs: (briefs: BriefSummary[]) => void;
  addBrief: (brief: BriefSummary) => void;
  removeBrief: (id: string) => void;
  clearBriefs: () => void;
  addToolCall: (call: ToolCall) => void;
  clearToolCallLog: () => void;
  setPendingApprovals: (approvals: ApprovalRequest[]) => void;
  removeApproval: (id: string) => void;
  addToHistory: (command: string, attachments?: AgentAttachmentSummary[]) => void;
  addActiveAttachment: (attachment: AgentAttachmentUiState) => void;
  updateActiveAttachment: (
    attachment: Partial<AgentAttachmentUiState> & Pick<AgentAttachmentUiState, 'id'>,
  ) => void;
  removeActiveAttachment: (id: string) => void;
  clearActiveAttachments: () => void;
  setDrawerOpen: (open: boolean) => void;
  setDrawerFullscreen: (fullscreen: boolean) => void;
  setResponseMode: (mode: 'concise' | 'standard') => void;
  setPrefill: (text: string) => void;
  clearPrefill: () => void;

  // Three-mode posture actions (Phase 14)
  setLockedMode: (mode: AgentMode | null) => void;
  setDetectedMode: (mode: AgentMode) => void;

  // Expansion actions
  expandMessage: (messageId: number) => void;
  appendExpansion: (messageId: number, chunk: string) => void;
  completeExpansion: (messageId: number) => void;
  addGeneratedImageToMessage: (messageId: number, image: GeneratedImageAttachment) => void;
  addGeneratedVideoToMessage: (messageId: number, video: GeneratedVideoAttachment) => void;
  /** Mark an assistant message (by timestamp) as posted to X / emailed. Persisted. */
  markMessagePostedToX: (
    timestamp: number,
    postedToX: { tweetId: string; tweetUrl: string; postedAt: number },
  ) => void;
  markMessageEmailed: (timestamp: number, emailedAt: number, emailRecipient?: string) => void;

  // Conversation grouping actions
  startConversation: (query: string) => string;
  completeConversation: (id: string, response: string) => void;
  failConversation: (id: string) => void;
  addToolCallToConversation: (id: string, call: ToolCall) => void;

  // Autonomous result actions
  addAutonomousResult: (result: AutonomousResultItem) => void;
  dismissAutonomousResult: (id: string) => void;
  addXPostJob: (job: XPostJobItem) => void;
  updateXPostJob: (jobToken: string, patch: Partial<XPostJobItem>) => void;
  dismissXPostJob: (jobToken: string) => void;
  clearAutonomousResults: () => void;
  setAutonomousAlertsEnabled: (enabled: boolean) => void;
  toggleAutonomousAlerts: () => void;
  setBreakingAlertThreshold: (threshold: BreakingAlertThreshold) => void;

  // Unified message log
  addMessage: (msg: ConversationMessage) => void;

  // Clear conversation
  clearConversation: () => void;
}

const MAX_TOOL_LOG = 50;
const MAX_HISTORY = 20;
const MAX_MESSAGES = 100;
const MAX_CONVERSATIONS = 50;
const MAX_BRIEFS = 20;

export const useAgentStore = create<AgentState>()(
  persist(
    (set) => ({
      status: 'idle',
      currentTask: null,

      streamingText: '',
      isStreaming: false,

      latestResponse: null,
      recentBriefs: [],
      toolCallLog: [],

      pendingApprovals: [],

      commandHistory: [],
      activeAttachments: [],

      messages: [],
      drawerOpen: false,
      drawerFullscreen: false,
      lastSeenAt: null,
      prefillText: null,
      responseMode: 'standard',
      autoSend: false,

      lockedMode: null,
      detectedMode: 'anchor',

      conversations: [],
      activeConversationId: null,

      autonomousResults: [],
      xPostJobs: [],
      autonomousAlertsEnabled: true,
      breakingAlertThreshold: 'critical',

      setStatus: (status) => set({ status }),
      setCurrentTask: (task) => set({ currentTask: task }),

      appendStreamingText: (chunk) =>
        set((state) => ({ streamingText: state.streamingText + chunk })),

      setIsStreaming: (streaming) => set({ isStreaming: streaming }),

      clearStreamingText: () => set({ streamingText: '' }),

      setLatestResponse: (
        response,
        channelSwitch,
        citationRepairs,
        youtubeResults,
        sourceContext,
        generatedMedia,
        sourceAttachments,
        agentMode,
      ) =>
        set((state) => ({
          latestResponse: response,
          status: 'idle',
          currentTask: null,
          isStreaming: false,
          messages: [
            ...state.messages,
            {
              role: 'assistant' as const,
              content: response.text,
              timestamp: Date.now(),
              origin: 'agent' as const,
              responseMode: state.responseMode,
              ...(channelSwitch ? { channelSwitch } : {}),
              ...(citationRepairs ? { citationRepairs } : {}),
              ...(youtubeResults ? { youtubeResults } : {}),
              ...(sourceContext ? { sourceContext } : {}),
              ...(generatedMedia?.images && generatedMedia.images.length > 0
                ? { generatedImages: generatedMedia.images }
                : {}),
              ...(generatedMedia?.videos && generatedMedia.videos.length > 0
                ? { generatedVideos: generatedMedia.videos }
                : {}),
              ...(sourceAttachments && sourceAttachments.length > 0
                ? { attachments: sourceAttachments }
                : {}),
              ...(agentMode ? { agentMode } : {}),
            },
          ].slice(-MAX_MESSAGES),
        })),

      setRecentBriefs: (briefs) => set({ recentBriefs: briefs }),

      addBrief: (brief) =>
        set((state) => ({
          recentBriefs: [brief, ...state.recentBriefs].slice(0, MAX_BRIEFS),
        })),

      removeBrief: (id) =>
        set((state) => ({
          recentBriefs: state.recentBriefs.filter((b) => b.id !== id),
        })),

      clearBriefs: () => set({ recentBriefs: [] }),

      addToolCall: (call) =>
        set((state) => ({
          toolCallLog: [call, ...state.toolCallLog].slice(0, MAX_TOOL_LOG),
        })),

      clearToolCallLog: () => set({ toolCallLog: [] }),

      setPendingApprovals: (approvals) => set({ pendingApprovals: approvals }),

      removeApproval: (id) =>
        set((state) => ({
          pendingApprovals: state.pendingApprovals.filter((a) => a.id !== id),
        })),

      addToHistory: (command, attachments) =>
        set((state) => ({
          commandHistory: [command, ...state.commandHistory.filter((c) => c !== command)].slice(
            0,
            MAX_HISTORY,
          ),
          messages: [
            ...state.messages,
            {
              role: 'user' as const,
              content: command,
              timestamp: Date.now(),
              origin: 'agent' as const,
              ...(attachments && attachments.length > 0 ? { attachments } : {}),
            },
          ].slice(-MAX_MESSAGES),
          drawerOpen: true,
          // Intentionally do NOT touch `drawerFullscreen` here — submitting a
          // message inside an active conversation must preserve fullscreen.
          // Explicit close (`setDrawerOpen(false)`) and persist `merge()` are
          // the only places that reset it.
          responseMode: 'standard',
        })),

      addActiveAttachment: (attachment) =>
        set((state) => {
          const withoutExisting = state.activeAttachments.filter(
            (item) => item.id !== attachment.id,
          );
          return { activeAttachments: [...withoutExisting, attachment].slice(-10) };
        }),

      updateActiveAttachment: (attachment) =>
        set((state) => ({
          activeAttachments: state.activeAttachments.map((item) =>
            item.id === attachment.id ? { ...item, ...attachment } : item,
          ),
        })),

      removeActiveAttachment: (id) =>
        set((state) => ({
          activeAttachments: state.activeAttachments.filter((item) => item.id !== id),
        })),

      clearActiveAttachments: () => set({ activeAttachments: [] }),

      setDrawerOpen: (open) =>
        set({
          drawerOpen: open,
          drawerFullscreen: false,
          // Stamp "last visit" on close so the next open can show a
          // "what changed since" delta (Proactive Max, Phase 1E).
          ...(open ? {} : { lastSeenAt: new Date().toISOString() }),
        }),
      setDrawerFullscreen: (fullscreen) => set({ drawerFullscreen: fullscreen }),
      setResponseMode: (mode) => set({ responseMode: mode }),

      setLockedMode: (mode) => set({ lockedMode: mode }),
      setDetectedMode: (mode) => set({ detectedMode: mode }),
      setPrefill: (text) =>
        set({
          prefillText: text,
          drawerOpen: true,
          // Preserve `drawerFullscreen` for the same reason as `addToHistory` —
          // a panel quick-action triggering a prefill is mid-conversation
          // semantics, not a fresh-open.
          responseMode: 'concise',
          autoSend: true,
        }),
      clearPrefill: () => set({ prefillText: null, autoSend: false }),

      // Expansion actions
      expandMessage: (messageId) =>
        set((state) => ({
          messages: state.messages.map((m, idx) =>
            idx === messageId ? { ...m, isExpanding: true } : m,
          ),
        })),
      appendExpansion: (messageId, chunk) =>
        set((state) => ({
          messages: state.messages.map((m, idx) =>
            idx === messageId ? { ...m, expansion: (m.expansion ?? '') + chunk } : m,
          ),
        })),
      completeExpansion: (messageId) =>
        set((state) => ({
          messages: state.messages.map((m, idx) =>
            idx === messageId ? { ...m, isExpanding: false } : m,
          ),
        })),

      addGeneratedImageToMessage: (messageId, image) =>
        set((state) => ({
          messages: state.messages.map((m, idx) => {
            if (idx !== messageId) return m;
            const existing = m.generatedImages ?? [];
            const existingIndex = existing.findIndex(
              (item) => item.generatedMediaId === image.generatedMediaId,
            );
            if (existingIndex === -1) {
              return { ...m, generatedImages: [...existing, image] };
            }
            return {
              ...m,
              generatedImages: existing.map((item, itemIndex) =>
                itemIndex === existingIndex ? { ...item, ...image, updatedAt: Date.now() } : item,
              ),
            };
          }),
        })),

      addGeneratedVideoToMessage: (messageId, video) =>
        set((state) => ({
          messages: state.messages.map((m, idx) => {
            if (idx !== messageId) return m;
            const existing = m.generatedVideos ?? [];
            const existingIndex = existing.findIndex(
              (item) => item.generatedMediaId === video.generatedMediaId,
            );
            if (existingIndex === -1) {
              return { ...m, generatedVideos: [...existing, video] };
            }
            return {
              ...m,
              generatedVideos: existing.map((item, itemIndex) =>
                itemIndex === existingIndex ? { ...item, ...video, updatedAt: Date.now() } : item,
              ),
            };
          }),
        })),

      markMessagePostedToX: (timestamp, postedToX) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.role === 'assistant' && m.timestamp === timestamp ? { ...m, postedToX } : m,
          ),
        })),

      markMessageEmailed: (timestamp, emailedAt, emailRecipient) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.role === 'assistant' && m.timestamp === timestamp
              ? { ...m, emailedAt, emailRecipient }
              : m,
          ),
        })),

      // Conversation grouping actions
      startConversation: (query) => {
        const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((state) => ({
          conversations: [
            {
              id,
              query,
              toolCalls: [] as ToolCall[],
              response: null,
              status: 'active' as const,
              startedAt: Date.now(),
              completedAt: null,
            },
            ...state.conversations,
          ].slice(0, MAX_CONVERSATIONS),
          activeConversationId: id,
        }));
        return id;
      },

      completeConversation: (id, response) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id
              ? { ...c, status: 'completed' as const, response, completedAt: Date.now() }
              : c,
          ),
          activeConversationId:
            state.activeConversationId === id ? null : state.activeConversationId,
        })),

      failConversation: (id) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, status: 'error' as const, completedAt: Date.now() } : c,
          ),
          activeConversationId:
            state.activeConversationId === id ? null : state.activeConversationId,
        })),

      addToolCallToConversation: (id, call) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, toolCalls: [...c.toolCalls, call] } : c,
          ),
        })),

      addAutonomousResult: (result) =>
        set((state) => ({
          autonomousResults: [result, ...state.autonomousResults].slice(0, 20),
        })),

      dismissAutonomousResult: (id) =>
        set((state) => ({
          autonomousResults: state.autonomousResults.map((r) =>
            r.id === id ? { ...r, dismissed: true } : r,
          ),
        })),

      clearAutonomousResults: () => set({ autonomousResults: [] }),

      setAutonomousAlertsEnabled: (enabled) => set({ autonomousAlertsEnabled: enabled }),

      toggleAutonomousAlerts: () =>
        set((state) => ({ autonomousAlertsEnabled: !state.autonomousAlertsEnabled })),

      setBreakingAlertThreshold: (threshold) => set({ breakingAlertThreshold: threshold }),

      addXPostJob: (job) =>
        set((state) => {
          const exists = state.xPostJobs.some((j) => j.jobToken === job.jobToken);
          return {
            xPostJobs: exists
              ? state.xPostJobs.map((j) => (j.jobToken === job.jobToken ? { ...j, ...job } : j))
              : [job, ...state.xPostJobs].slice(0, 20),
          };
        }),

      updateXPostJob: (jobToken, patch) =>
        set((state) => ({
          xPostJobs: state.xPostJobs.map((j) => {
            if (j.jobToken !== jobToken) return j;
            // A terminal outcome (posted/failed/needs_reconnect) re-surfaces the
            // toast even if the user dismissed the in-progress one — dismiss only
            // hides it, it never cancels the post, so they still get confirmation.
            const reSurface = patch.status ? isTerminalXPostStatus(patch.status) : false;
            return {
              ...j,
              ...patch,
              updatedAt: Date.now(),
              ...(reSurface ? { dismissed: false } : {}),
            };
          }),
        })),

      dismissXPostJob: (jobToken) =>
        set((state) => ({
          xPostJobs: state.xPostJobs.map((j) =>
            j.jobToken === jobToken ? { ...j, dismissed: true } : j,
          ),
        })),

      addMessage: (msg) =>
        set((state) => ({
          messages: [...state.messages, msg].slice(-MAX_MESSAGES),
        })),

      clearConversation: () =>
        set({
          messages: [],
          conversations: [],
          commandHistory: [],
          activeAttachments: [],
          streamingText: '',
          activeConversationId: null,
          latestResponse: null,
        }),
    }),
    {
      name: 'threatdeck-agent',
      version: 2,
      // Only non-sensitive preferences survive a reload. Never hydrate legacy
      // conversations, commands, attachments, briefs or provider responses.
      migrate: () => ({}),
      partialize: (state) => ({
        lockedMode: state.lockedMode,
        autonomousAlertsEnabled: state.autonomousAlertsEnabled,
        breakingAlertThreshold: state.breakingAlertThreshold,
      }),
      merge: (persisted, current) => {
        const stored = persisted as
          | Partial<
              Pick<
                typeof current,
                'lockedMode' | 'autonomousAlertsEnabled' | 'breakingAlertThreshold'
              >
            >
          | undefined;
        return {
          ...current,
          lockedMode: stored?.lockedMode ?? null,
          autonomousAlertsEnabled: stored?.autonomousAlertsEnabled ?? true,
          breakingAlertThreshold: stored?.breakingAlertThreshold ?? 'critical',
        };
      },
    },
  ),
);

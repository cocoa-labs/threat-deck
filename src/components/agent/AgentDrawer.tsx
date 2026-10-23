'use client';

import {
  Binary,
  Bot,
  CheckCircle,
  Download,
  ExternalLink,
  FileText,
  Film,
  ImageIcon,
  Mail,
  Maximize2,
  Minimize2,
  Paperclip,
  Table2,
  Trash2,
  User,
  X,
  Zap,
} from 'lucide-react';
import Image from 'next/image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentStatusIndicator } from '@/components/agent/AgentStatusIndicator';
import { ApprovalQueueSection } from '@/components/agent/ApprovalQueueSection';
import { EmailMeButton } from '@/components/agent/EmailMeButton';
import { GenerateImageButton } from '@/components/agent/GenerateImageButton';
import { GenerateVideoButton } from '@/components/agent/GenerateVideoButton';
import { MatrixRainBackdrop } from '@/components/agent/MatrixRainBackdrop';
import { ModeBadge, ModePillRow } from '@/components/agent/ModePillRow';
import { PostToXButton } from '@/components/agent/PostToXButton';
import { CocoaWordmark } from '@/components/brand/CocoaWordmark';
import { ChannelSwitchCard } from '@/components/companion/ChannelSwitchCard';
import { YouTubeSearchResultCard } from '@/components/companion/YouTubeSearchResultCard';
import type { AgentMode } from '@/lib/agent/mode-config';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { AGENT_SUGGESTIONS } from '@/lib/constants/suggestions';
import { claimMediaPoll, releaseMediaPoll } from '@/lib/hooks/media-poll-registry';
import { markGeneratedVideoGaveUp, useAgentStream } from '@/lib/hooks/use-agent-stream';
import { useSessionDelta } from '@/lib/hooks/use-session-delta';
import { useStickToBottom } from '@/lib/hooks/use-stick-to-bottom';
import type {
  ConversationMessage,
  GeneratedImageAttachment,
  GeneratedVideoAttachment,
  XPostJobItem,
} from '@/lib/store/agent-store';
import { isTerminalXPostStatus, useAgentStore } from '@/lib/store/agent-store';
import { useCompanionStore } from '@/lib/store/companion-store';
import { usePanelsStore } from '@/lib/store/panels-store';
import { cn } from '@/lib/utils/cn';
import { BlufCard, renderMarkdown } from '@/lib/utils/markdown-renderer';
import { prefillAgent } from '@/lib/utils/panel-actions';
import {
  downloadGeneratedImage,
  downloadGeneratedVideo,
} from '@/lib/visual/download-generated-image';

/* ─── URL detection helper ─── */

function isUrl(value: string): boolean {
  return /^(https?:\/\/|\/)/.test(value);
}

/* ─── User message context parsing ─── */

interface ParsedContext {
  sourcePanel: string;
  dataType: string;
  trendData?: Record<string, unknown>;
  [key: string]: unknown;
}

function parseUserMessage(content: string): { prompt: string; context: ParsedContext | null } {
  const match = content.match(/<context>([\s\S]*?)<\/context>/);
  if (!match) return { prompt: content, context: null };

  const prompt = content.replace(/<context>[\s\S]*?<\/context>/, '').trim();
  try {
    return { prompt, context: JSON.parse(match[1]!) as ParsedContext };
  } catch {
    return { prompt, context: null };
  }
}

/** Panel label formatting: snake_case → Title Case */
function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Keys to skip when displaying trendData fields (URLs extracted separately as source links) */
const SKIP_KEYS = new Set([
  'url',
  'sourceUrl',
  'link',
  'href',
  'publishedAt',
  'timestamp',
  'id',
  'guid',
  'count',
  'index',
  'raw',
  'html',
  'content',
  'description',
  'summary',
]);

/** Priority order for trendData display fields */
const PRIORITY_KEYS = [
  'title',
  'name',
  'symbol',
  'ticker',
  'source',
  'category',
  'authorName',
  'authorUsername',
  'author',
  'party',
  'representative',
  'amount',
  'value',
  'price',
  'change',
  'volume',
  'type',
  'asset',
  'sector',
  'exchange',
];

function extractDisplayFields(
  trendData: Record<string, unknown>,
): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  // Priority keys first
  for (const key of PRIORITY_KEYS) {
    if (fields.length >= 5) break;
    const val = trendData[key];
    if (val != null && val !== '' && typeof val !== 'object') {
      fields.push({ label: key, value: String(val) });
      seen.add(key);
    }
  }

  // Fill remaining slots from other keys
  for (const [key, val] of Object.entries(trendData)) {
    if (fields.length >= 5) break;
    if (seen.has(key) || SKIP_KEYS.has(key)) continue;
    if (val != null && val !== '' && typeof val !== 'object') {
      fields.push({ label: key, value: String(val) });
    }
  }

  return fields;
}

/** Extract the first available source URL from trendData */
function extractSourceUrl(data: Record<string, unknown>): string | null {
  for (const key of ['url', 'sourceUrl', 'link', 'href']) {
    const val = data[key];
    if (typeof val === 'string' && isUrl(val)) return val;
  }
  return null;
}

/* ─── Distribution gate for the EMAIL / Post to X buttons ─── */

/** Minimum char count for an agent reply to qualify for outbound distribution.
 *  Filters out trivial confirmations ("Got it.", "Switching channels.")
 *  without gating anything substantive. ~50 chars is roughly the length of
 *  a one-sentence acknowledgment; real analytical content always clears it
 *  by an order of magnitude. */
const MIN_DISTRIBUTABLE_LENGTH = 50;

/**
 * True when an agent message is substantive enough to be worth surfacing
 * EMAIL / Post-to-X buttons on. Per operator request (post-Tier-5.1):
 * "I would like for almost every output to almost be within that
 * capability." The gate is intentionally permissive — almost every
 * non-trivial agent reply gets the buttons. Only excluded:
 *
 *   - User messages (operator's own input)
 *   - Channel-switch confirmations (rendered as a ChannelSwitchCard, no
 *     prose body to distribute)
 *   - Very short replies (< 50 chars — trivial acks, ToolRegistry pings)
 *
 * YouTube search results PASS — the agent's prose reply alongside the
 * embedded video card is still distributable content.
 */
function isDistributableMessage(message: {
  role: 'user' | 'assistant';
  content: string;
  channelSwitch?: unknown;
}): boolean {
  if (message.role === 'user') return false;
  if (message.channelSwitch != null) return false;
  return message.content.trim().length >= MIN_DISTRIBUTABLE_LENGTH;
}

/** Persistent "Posted to X" (with permalink) + "Emailed" pills for a message's
 *  past outbound actions. Renders nothing until an action has occurred. */
function OutboundStatusBadges({ message }: { message: ConversationMessage }) {
  if (!message.postedToX && message.emailedAt == null) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
      {message.postedToX && (
        <a
          href={message.postedToX.tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider transition-[filter] hover:brightness-125"
          style={{
            background: 'rgba(68, 255, 136, 0.06)',
            border: '1px solid rgba(68, 255, 136, 0.18)',
            color: 'var(--color-positive)',
          }}
          title="Posted to X — open the thread"
        >
          <CheckCircle size={7} />
          Posted to X
          <ExternalLink size={7} />
        </a>
      )}
      {message.emailedAt != null && (
        <span
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider"
          style={{
            background: 'rgba(68, 255, 136, 0.06)',
            border: '1px solid rgba(68, 255, 136, 0.12)',
            color: 'var(--color-positive)',
          }}
          title={message.emailRecipient ? `Emailed to ${message.emailRecipient}` : 'Emailed'}
        >
          <Mail size={7} />
          Emailed
        </span>
      )}
    </div>
  );
}

/** Extract display domain from a URL (e.g., "https://api.stlouisfed.org/..." → "stlouisfed.org") */
function extractDomain(url: string): string {
  // Relative paths — show a readable label based on the AEGIS viewer route.
  if (url.startsWith('/')) {
    if (url.includes('/api/aegis/cves')) return 'AEGIS CVE';
    if (url.includes('/api/aegis/kev')) return 'AEGIS KEV';
    if (url.includes('/api/aegis/threat-actors')) return 'AEGIS Threat Actor';
    if (url.includes('/api/aegis/incidents')) return 'AEGIS Incident';
    if (url.includes('/api/aegis/defenses')) return 'AEGIS Defense';
    if (url.includes('/api/aegis/compromised-orgs')) return 'AEGIS Org Exposure';
    if (url.includes('/api/aegis/risk-simulation')) return 'AEGIS Risk Sim';
    if (url.includes('/api/aegis/')) return 'AEGIS Intelligence';
    return 'Threat Deck';
  }
  try {
    const host = new URL(url).hostname;
    // Strip common prefixes: www., api., pro-api., etc.
    return host.replace(/^(www\.|api\.|pro-api\.|pro\.)/, '');
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}...` : url;
  }
}

function UserMessageContent({ content }: { content: string }) {
  const { prompt, context } = parseUserMessage(content);

  if (!context) return <>{prompt}</>;

  const displayFields = context.trendData ? extractDisplayFields(context.trendData) : [];
  const sourceUrl = context.trendData ? extractSourceUrl(context.trendData) : null;

  return (
    <>
      <span>{prompt}</span>
      <div
        className="mt-2 rounded px-2.5 py-2 text-[9px] font-mono leading-relaxed"
        style={{
          background: 'rgba(var(--crt-glow-rgb), 0.04)',
          border: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
        }}
      >
        {/* Source badge + data type */}
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
            style={{
              background: 'rgba(var(--crt-glow-rgb), 0.1)',
              color: 'var(--crt-glow)',
              border: '1px solid rgba(var(--crt-glow-rgb), 0.2)',
            }}
          >
            {formatLabel(context.sourcePanel)}
          </span>
          <span style={{ color: 'var(--text-dim)' }}>{formatLabel(context.dataType)}</span>
        </div>

        {/* Key-value fields from trendData */}
        {displayFields.length > 0 && (
          <div className="space-y-0.5">
            {displayFields.map((f) => (
              <div key={f.label} className="flex gap-2">
                <span
                  className="shrink-0 uppercase tracking-wider"
                  style={{ color: 'rgba(var(--crt-glow-rgb), 0.5)', minWidth: '60px' }}
                >
                  {formatLabel(f.label)}
                </span>
                <span className="text-[var(--text-primary)] truncate">
                  {isUrl(f.value) ? (
                    <a
                      href={f.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 hover:underline"
                      style={{ color: 'var(--crt-glow)' }}
                    >
                      {f.value.length > 40 ? `${f.value.slice(0, 40)}...` : f.value}
                      <ExternalLink size={8} className="inline shrink-0 opacity-60" />
                    </a>
                  ) : (
                    f.value
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Dedicated source link — always visible when available */}
        {sourceUrl && (
          <div
            className="mt-1.5 pt-1.5 flex items-center"
            style={{ borderTop: '1px solid rgba(var(--crt-glow-rgb), 0.08)' }}
          >
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:underline"
              style={{
                color: 'var(--crt-glow)',
                background: 'rgba(var(--crt-glow-rgb), 0.06)',
                border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
              }}
            >
              <ExternalLink size={8} className="shrink-0" />
              <span className="uppercase tracking-wider text-[8px]">Source</span>
              <span className="text-[8px] opacity-60">{extractDomain(sourceUrl)}</span>
            </a>
          </div>
        )}
      </div>
    </>
  );
}

function UploadedAttachmentChips({
  attachments,
  label,
}: {
  attachments: NonNullable<ConversationMessage['attachments']>;
  label: string;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider text-[var(--text-dim)]">
        <Paperclip size={9} />
        {label}
      </span>
      {attachments.map((attachment) => {
        const icon =
          attachment.kind === 'image' ? (
            <ImageIcon size={9} />
          ) : attachment.kind === 'spreadsheet' ? (
            <Table2 size={9} />
          ) : (
            <FileText size={9} />
          );
        const chip = (
          <>
            {icon}
            <span className="max-w-[150px] truncate">{attachment.filename}</span>
            <span className="uppercase opacity-55">{attachment.kind}</span>
          </>
        );

        if (attachment.blobUrl) {
          return (
            <a
              key={attachment.id}
              href={attachment.blobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-[var(--crt-glow)]/18 bg-[var(--crt-glow)]/5 px-1.5 py-0.5 text-[8px] font-mono text-[var(--text-secondary)] hover:border-[var(--crt-glow)]/35 hover:text-[var(--crt-glow)]"
              title={attachment.summary ?? attachment.filename}
            >
              {chip}
            </a>
          );
        }

        return (
          <span
            key={attachment.id}
            className="inline-flex items-center gap-1 rounded border border-[var(--crt-glow)]/18 bg-[var(--crt-glow)]/5 px-1.5 py-0.5 text-[8px] font-mono text-[var(--text-secondary)]"
            title={attachment.summary ?? attachment.filename}
          >
            {chip}
          </span>
        );
      })}
    </div>
  );
}

/* ─── Message bubble — CRT-styled ─── */

function GeneratedImageAttachments({ images }: { images: GeneratedImageAttachment[] }) {
  if (images.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {images.map((image, index) => {
        const blobUrl = image.blobUrl;
        const isFailed = image.status === 'failed';
        return (
          <div
            key={image.generatedMediaId}
            className="rounded border p-2"
            style={{
              background: 'rgba(var(--crt-glow-rgb), 0.035)',
              borderColor: 'rgba(var(--crt-glow-rgb), 0.18)',
            }}
          >
            <div
              className="mb-1.5 flex items-center justify-between gap-2 text-[8px] font-mono font-bold uppercase tracking-wider"
              style={{ color: 'var(--matrix-green, #00ff41)' }}
            >
              <span className="inline-flex items-center gap-1">
                <ImageIcon size={9} />
                Generated image {index + 1}
              </span>
              {image.styleTag && (
                <span className="opacity-55">{image.styleTag.replace(/_/g, ' ')}</span>
              )}
            </div>
            {blobUrl ? (
              <>
                <a
                  href={blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                  title="Open generated image"
                >
                  <Image
                    src={blobUrl}
                    alt={`Generated visual ${index + 1}`}
                    width={1200}
                    height={2400}
                    unoptimized
                    className="max-h-72 w-full border object-contain"
                    style={{ borderColor: 'rgba(var(--crt-glow-rgb), 0.24)' }}
                  />
                </a>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[8px] font-mono uppercase tracking-wider">
                  <span style={{ color: 'var(--text-muted)' }}>
                    {new Date(image.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        void downloadGeneratedImage(blobUrl, image.generatedMediaId);
                      }}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                      style={{
                        color: 'var(--matrix-green, #00ff41)',
                        background: 'rgba(var(--crt-glow-rgb), 0.06)',
                        border: '1px solid rgba(var(--crt-glow-rgb), 0.18)',
                      }}
                    >
                      <Download size={8} />
                      Download
                    </button>
                    <a
                      href={blobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                      style={{
                        color: 'var(--matrix-green, #00ff41)',
                        background: 'rgba(var(--crt-glow-rgb), 0.06)',
                        border: '1px solid rgba(var(--crt-glow-rgb), 0.18)',
                      }}
                    >
                      <ExternalLink size={8} />
                      Open full
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div
                className="flex items-center gap-1.5 px-1 py-1.5 text-[9px] font-mono"
                style={{
                  color: isFailed ? 'var(--severity-critical, #ff0040)' : 'var(--text-muted)',
                }}
              >
                {isFailed ? <X size={10} /> : <Zap size={10} className="animate-pulse" />}
                <span>
                  {isFailed
                    ? `Image generation failed${image.errorMessage ? ` — ${image.errorMessage}` : '.'}`
                    : 'Generating image…'}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function videoStatusOf(video: GeneratedVideoAttachment): 'pending' | 'ready' | 'failed' {
  if (video.status === 'failed') return 'failed';
  if (video.status === 'ready' || video.blobUrl) return 'ready';
  return 'pending';
}

function formatProviderStatus(status?: string): string {
  if (!status) return 'Queued';
  return status.replace(/_/g, ' ');
}

type GeneratedMediaStatusPayload = {
  ok?: boolean;
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

function isPendingGeneratedVideo(video: GeneratedVideoAttachment): boolean {
  return video.status !== 'ready' && video.status !== 'failed' && !video.blobUrl && !!video.pollUrl;
}

function generatedVideoFromStatus(
  data: GeneratedMediaStatusPayload,
  fallback: GeneratedVideoAttachment,
): GeneratedVideoAttachment | null {
  if (data.mediaKind !== 'video') return null;
  if (typeof data.generatedMediaId !== 'string' || data.generatedMediaId.length === 0) return null;
  const status =
    data.status === 'ready' || data.status === 'failed' || data.status === 'pending'
      ? data.status
      : fallback.status;
  const blobUrl =
    typeof data.blobUrl === 'string' && data.blobUrl.length > 0 ? data.blobUrl : fallback.blobUrl;

  return {
    generatedMediaId: data.generatedMediaId,
    ...(blobUrl ? { blobUrl } : {}),
    ...(typeof data.styleTag === 'string' ? { styleTag: data.styleTag } : {}),
    ...(status ? { status } : {}),
    ...(typeof data.pollUrl === 'string' ? { pollUrl: data.pollUrl } : {}),
    ...(typeof data.providerJobId === 'string' ? { providerJobId: data.providerJobId } : {}),
    ...(typeof data.providerStatus === 'string' ? { providerStatus: data.providerStatus } : {}),
    ...(typeof data.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
    createdAt: fallback.createdAt,
    updatedAt: Date.now(),
  };
}

function isPendingGeneratedImage(image: GeneratedImageAttachment): boolean {
  return image.status !== 'ready' && image.status !== 'failed' && !image.blobUrl && !!image.pollUrl;
}

function generatedImageFromStatus(
  data: GeneratedMediaStatusPayload,
  fallback: GeneratedImageAttachment,
): GeneratedImageAttachment | null {
  if (data.mediaKind !== 'image') return null;
  if (typeof data.generatedMediaId !== 'string' || data.generatedMediaId.length === 0) return null;
  const status =
    data.status === 'ready' || data.status === 'failed' || data.status === 'pending'
      ? data.status
      : fallback.status;
  const blobUrl =
    typeof data.blobUrl === 'string' && data.blobUrl.length > 0 ? data.blobUrl : fallback.blobUrl;

  return {
    generatedMediaId: data.generatedMediaId,
    ...(blobUrl ? { blobUrl } : {}),
    ...(typeof data.styleTag === 'string' ? { styleTag: data.styleTag } : {}),
    ...(status ? { status } : {}),
    ...(typeof data.pollUrl === 'string' ? { pollUrl: data.pollUrl } : {}),
    ...(typeof data.providerJobId === 'string' ? { providerJobId: data.providerJobId } : {}),
    ...(typeof data.providerStatus === 'string' ? { providerStatus: data.providerStatus } : {}),
    ...(typeof data.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
    createdAt: fallback.createdAt,
    updatedAt: Date.now(),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ~6 minutes at 2s. Seedance quotes 1-3 min; past this the render is not
 *  coming back on this tab and the card must say so rather than spin. */
const VIDEO_POLL_ATTEMPTS = 180;

// ─── Background X-post job tracking ───
interface XPostJobPayload {
  ok?: boolean;
  jobToken: string;
  status: XPostJobItem['status'];
  pollUrl: string;
  publishMode: 'single' | 'two_post';
  primaryTextPreview: string;
  tweetIds: string[];
  tweetUrl?: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  generatedMediaId?: string | null;
  messageTimestamp?: number;
  createdAt: string;
  updatedAt: string;
}

function xPostPayloadToItem(v: XPostJobPayload): XPostJobItem {
  return {
    jobToken: v.jobToken,
    status: v.status,
    pollUrl: v.pollUrl,
    ...(typeof v.messageTimestamp === 'number' ? { messageTimestamp: v.messageTimestamp } : {}),
    publishMode: v.publishMode,
    primaryTextPreview: v.primaryTextPreview,
    tweetIds: Array.isArray(v.tweetIds) ? v.tweetIds : [],
    errorCode: v.errorCode ?? null,
    errorMessage: v.errorMessage ?? null,
    createdAt: Date.parse(v.createdAt) || Date.now(),
    updatedAt: Date.parse(v.updatedAt) || Date.now(),
    dismissed: false,
  };
}

function GeneratedVideoAttachments({ videos }: { videos: GeneratedVideoAttachment[] }) {
  if (videos.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {videos.map((video, index) => {
        const status = videoStatusOf(video);
        const isReady = status === 'ready' && video.blobUrl;
        const isFailed = status === 'failed';
        const statusLabel = isReady
          ? 'Ready'
          : isFailed
            ? 'Failed'
            : formatProviderStatus(video.providerStatus);
        const statusColor = isFailed
          ? 'var(--severity-critical, #ff0040)'
          : 'var(--matrix-green, #00ff41)';
        const displayedAt = new Date(video.updatedAt ?? video.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={video.generatedMediaId}
            className="rounded border p-2"
            style={{
              background: 'rgba(var(--crt-glow-rgb), 0.035)',
              borderColor: 'rgba(var(--crt-glow-rgb), 0.18)',
            }}
          >
            <div
              className="mb-1.5 flex items-center justify-between gap-2 text-[8px] font-mono font-bold uppercase tracking-wider"
              style={{ color: 'var(--matrix-green, #00ff41)' }}
            >
              <span className="inline-flex items-center gap-1">
                <Film size={9} />
                Generated video {index + 1}
              </span>
              <span className="inline-flex items-center gap-1">
                {video.styleTag && (
                  <span className="opacity-55">{video.styleTag.replace(/_/g, ' ')}</span>
                )}
                <span
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                  style={{
                    color: statusColor,
                    background: isFailed
                      ? 'rgba(255, 0, 64, 0.08)'
                      : 'rgba(var(--crt-glow-rgb), 0.08)',
                    border: isFailed
                      ? '1px solid rgba(255, 0, 64, 0.22)'
                      : '1px solid rgba(var(--crt-glow-rgb), 0.2)',
                  }}
                >
                  {isReady ? (
                    <CheckCircle size={8} />
                  ) : isFailed ? (
                    <X size={8} />
                  ) : (
                    <Zap size={8} className="animate-pulse" />
                  )}
                  {statusLabel}
                </span>
              </span>
            </div>

            {isReady ? (
              <video
                src={video.blobUrl}
                controls
                playsInline
                preload="metadata"
                className="max-h-72 w-full border bg-black object-contain"
                style={{ borderColor: 'rgba(var(--crt-glow-rgb), 0.24)' }}
              >
                <track
                  default
                  kind="captions"
                  label="No dialogue captions available"
                  src="data:text/vtt,WEBVTT%0A%0A"
                  srcLang="en"
                />
              </video>
            ) : (
              <div
                className="flex min-h-48 w-full items-center justify-center border bg-black/60 px-4 py-8 text-center font-mono"
                style={{ borderColor: 'rgba(var(--crt-glow-rgb), 0.24)' }}
              >
                <div className="max-w-sm space-y-2">
                  <div
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-full"
                    style={{
                      color: statusColor,
                      background: isFailed
                        ? 'rgba(255, 0, 64, 0.09)'
                        : 'rgba(var(--crt-glow-rgb), 0.08)',
                      border: isFailed
                        ? '1px solid rgba(255, 0, 64, 0.24)'
                        : '1px solid rgba(var(--crt-glow-rgb), 0.22)',
                    }}
                  >
                    {isFailed ? <X size={15} /> : <Zap size={15} className="animate-pulse" />}
                  </div>
                  <div
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: statusColor }}
                  >
                    {isFailed ? 'Seedance render failed' : 'Seedance render in progress'}
                  </div>
                  <div className="text-[9px] leading-relaxed text-[var(--text-muted)]">
                    {isFailed
                      ? (video.errorMessage ?? 'The provider returned a failed status.')
                      : 'Max is polling Higgsfield and will attach the playable MP4 here automatically.'}
                  </div>
                  <div className="text-[8px] uppercase tracking-wider text-[var(--text-dim)]">
                    Job {video.providerJobId ?? video.generatedMediaId}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-1.5 flex items-center justify-between gap-2 text-[8px] font-mono uppercase tracking-wider">
              <span style={{ color: 'var(--text-muted)' }}>
                {isReady ? 'Ready' : isFailed ? 'Stopped' : 'Last checked'} {displayedAt}
              </span>
              {isReady && video.blobUrl && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (video.blobUrl) {
                        void downloadGeneratedVideo(video.blobUrl, video.generatedMediaId);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                    style={{
                      color: 'var(--matrix-green, #00ff41)',
                      background: 'rgba(var(--crt-glow-rgb), 0.06)',
                      border: '1px solid rgba(var(--crt-glow-rgb), 0.18)',
                    }}
                  >
                    <Download size={8} />
                    Download
                  </button>
                  <a
                    href={video.blobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                    style={{
                      color: 'var(--matrix-green, #00ff41)',
                      background: 'rgba(var(--crt-glow-rgb), 0.06)',
                      border: '1px solid rgba(var(--crt-glow-rgb), 0.18)',
                    }}
                  >
                    <ExternalLink size={8} />
                    Open full
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MessageBubble = React.memo(function MessageBubble({
  message,
  messageIndex,
  onExpand,
}: {
  message: ConversationMessage;
  messageIndex: number;
  onExpand: (messageIndex: number, originalText: string) => void;
}) {
  const isUser = message.role === 'user';
  const time = new Date(message.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const renderedContent = useMemo(() => renderMarkdown(message.content), [message.content]);
  const renderedExpansion = useMemo(
    () => (message.expansion ? renderMarkdown(message.expansion) : null),
    [message.expansion],
  );
  const isChannelSwitch = !isUser && message.channelSwitch != null;
  const hasYoutubeResults = !isUser && message.youtubeResults != null;
  const isConcise = !isUser && message.responseMode === 'concise';
  const generatedImages = message.generatedImages ?? [];
  const generatedVideos = message.generatedVideos ?? [];
  const addGeneratedImageToMessage = useAgentStore((state) => state.addGeneratedImageToMessage);
  const handleImageReady = useCallback(
    (image: GeneratedImageAttachment) => {
      addGeneratedImageToMessage(messageIndex, image);
    },
    [addGeneratedImageToMessage, messageIndex],
  );
  const addGeneratedVideoToMessage = useAgentStore((state) => state.addGeneratedVideoToMessage);
  const handleVideoReady = useCallback(
    (video: GeneratedVideoAttachment) => {
      addGeneratedVideoToMessage(messageIndex, video);
    },
    [addGeneratedVideoToMessage, messageIndex],
  );
  /**
   * Show EMAIL + Post-to-X buttons on every substantive agent reply
   * (post-Tier-5.1 — gate broadened from the old critical-only filter).
   * Computed once and reused across all three render branches
   * (channel-switch, concise, standard).
   */
  const canDistribute = isDistributableMessage(message);

  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px]',
          isUser
            ? 'bg-[var(--color-info)]/15 text-[var(--color-info)]'
            : 'bg-[var(--color-positive)]/15 text-[var(--color-positive)]',
        )}
      >
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>

      {/* Channel switch → presentation card */}
      {isChannelSwitch ? (
        <div className="max-w-[88%] text-[11px] font-mono leading-relaxed">
          <ChannelSwitchCard data={message.channelSwitch!}>
            <div className="break-words text-[var(--text-secondary)]">{renderedContent}</div>
          </ChannelSwitchCard>
          <UploadedAttachmentChips attachments={message.attachments ?? []} label="Sources" />
          <div
            className="mt-1.5 flex items-center gap-1.5 text-[8px] font-mono tabular-nums px-1"
            style={{ color: 'var(--text-muted)' }}
          >
            {timeStr}
            <ModeBadge mode={message.agentMode} />
            {message.origin === 'companion' && (
              <span className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider">
                companion
              </span>
            )}
            {message.citationRepairs != null && message.citationRepairs > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider"
                style={{
                  background: 'rgba(68, 255, 136, 0.06)',
                  border: '1px solid rgba(68, 255, 136, 0.12)',
                  color: 'var(--color-positive)',
                }}
                title={`${message.citationRepairs} citation${message.citationRepairs > 1 ? 's' : ''} auto-corrected`}
              >
                <CheckCircle size={7} />
                {message.citationRepairs} corrected
              </span>
            )}
            {canDistribute && (
              <PostToXButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                generatedImages={generatedImages}
                generatedVideos={generatedVideos}
                sourceContext={message.sourceContext}
              />
            )}
            {canDistribute && (
              <EmailMeButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                generatedImages={generatedImages}
                generatedVideos={generatedVideos}
              />
            )}
            {canDistribute && (
              <GenerateImageButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                sourceContext={message.sourceContext}
                onImageReady={handleImageReady}
              />
            )}
            {canDistribute && (
              <GenerateVideoButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                sourceContext={message.sourceContext}
                onVideoReady={handleVideoReady}
              />
            )}
          </div>
          <OutboundStatusBadges message={message} />
          <GeneratedImageAttachments images={generatedImages} />
          <GeneratedVideoAttachments videos={generatedVideos} />
        </div>
      ) : isConcise ? (
        /* Concise BlufCard with Expand */
        <div className="max-w-[88%] text-[11px] font-mono leading-relaxed">
          <BlufCard reactKey={message.timestamp}>
            <div className="break-words text-[var(--text-secondary)]">{renderedContent}</div>
          </BlufCard>
          <UploadedAttachmentChips attachments={message.attachments ?? []} label="Sources" />
          {!message.expansion && !message.isExpanding && (
            <button
              type="button"
              onClick={() => onExpand(messageIndex, message.content)}
              className="mt-1 ml-1 rounded px-2 py-1 text-[8px] font-mono font-bold uppercase tracking-wider"
              style={{
                color: 'var(--crt-glow)',
                background: 'rgba(var(--crt-glow-rgb), 0.06)',
                border: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
              }}
            >
              ▸ Expand
            </button>
          )}
          {message.isExpanding && (
            <div className="mt-2 text-[9px] text-[var(--text-dim)] animate-pulse font-mono">
              Expanding analysis...
            </div>
          )}
          {renderedExpansion && (
            <div
              className="mt-2 px-3 py-2.5 text-[var(--text-secondary)]"
              style={{
                background: 'var(--crt-panel-bg)',
                border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
                boxShadow:
                  '0 0 6px rgba(var(--crt-glow-rgb), 0.05), inset 0 0 3px rgba(var(--crt-glow-rgb), 0.02)',
              }}
            >
              <div className="break-words">{renderedExpansion}</div>
            </div>
          )}
          <div
            className="mt-1.5 flex items-center gap-1.5 text-[8px] font-mono tabular-nums px-1"
            style={{ color: 'var(--text-muted)' }}
          >
            {timeStr}
            <ModeBadge mode={message.agentMode} />
            {message.citationRepairs != null && message.citationRepairs > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider"
                style={{
                  background: 'rgba(68, 255, 136, 0.06)',
                  border: '1px solid rgba(68, 255, 136, 0.12)',
                  color: 'var(--color-positive)',
                }}
                title={`${message.citationRepairs} citation${message.citationRepairs > 1 ? 's' : ''} auto-corrected`}
              >
                <CheckCircle size={7} />
                {message.citationRepairs} corrected
              </span>
            )}
            {canDistribute && (
              <PostToXButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                generatedImages={generatedImages}
                generatedVideos={generatedVideos}
                sourceContext={message.sourceContext}
              />
            )}
            {canDistribute && (
              <EmailMeButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                generatedImages={generatedImages}
                generatedVideos={generatedVideos}
              />
            )}
            {canDistribute && (
              <GenerateImageButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                sourceContext={message.sourceContext}
                onImageReady={handleImageReady}
              />
            )}
            {canDistribute && (
              <GenerateVideoButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                sourceContext={message.sourceContext}
                onVideoReady={handleVideoReady}
              />
            )}
          </div>
          <OutboundStatusBadges message={message} />
          <GeneratedImageAttachments images={generatedImages} />
          <GeneratedVideoAttachments videos={generatedVideos} />
        </div>
      ) : (
        /* Standard bubble */
        <div
          className={cn(
            'max-w-[88%] px-3 py-2.5 text-[11px] font-mono leading-relaxed',
            isUser
              ? 'rounded-lg bg-[var(--color-info)]/8 text-[var(--text-primary)] border border-[var(--color-info)]/20'
              : 'text-[var(--text-secondary)]',
          )}
          style={
            isUser
              ? undefined
              : {
                  background: 'var(--crt-panel-bg)',
                  border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
                  boxShadow:
                    '0 0 6px rgba(var(--crt-glow-rgb), 0.05), inset 0 0 3px rgba(var(--crt-glow-rgb), 0.02)',
                }
          }
        >
          <div className="break-words">
            {isUser ? <UserMessageContent content={message.content} /> : renderedContent}
          </div>
          <UploadedAttachmentChips
            attachments={message.attachments ?? []}
            label={isUser ? 'Attached' : 'Sources'}
          />
          {hasYoutubeResults && message.youtubeResults!.autoPlay && (
            <YouTubeSearchResultCard
              autoPlay={message.youtubeResults!.autoPlay}
              alternatives={message.youtubeResults!.alternatives}
              query={message.youtubeResults!.query}
            />
          )}
          <div
            className="mt-2 flex items-center gap-1.5 text-[8px] font-mono tabular-nums"
            style={{ color: 'var(--text-muted)' }}
          >
            {timeStr}
            <ModeBadge mode={message.agentMode} />
            {message.origin === 'companion' && (
              <span className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider">
                companion
              </span>
            )}
            {message.citationRepairs != null && message.citationRepairs > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] font-mono uppercase tracking-wider"
                style={{
                  background: 'rgba(68, 255, 136, 0.06)',
                  border: '1px solid rgba(68, 255, 136, 0.12)',
                  color: 'var(--color-positive)',
                }}
                title={`${message.citationRepairs} citation${message.citationRepairs > 1 ? 's' : ''} auto-corrected`}
              >
                <CheckCircle size={7} />
                {message.citationRepairs} corrected
              </span>
            )}
            {canDistribute && (
              <PostToXButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                generatedImages={generatedImages}
                generatedVideos={generatedVideos}
                sourceContext={message.sourceContext}
              />
            )}
            {canDistribute && (
              <EmailMeButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                generatedImages={generatedImages}
                generatedVideos={generatedVideos}
              />
            )}
            {canDistribute && (
              <GenerateImageButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                sourceContext={message.sourceContext}
                onImageReady={handleImageReady}
              />
            )}
            {canDistribute && (
              <GenerateVideoButton
                messageContent={message.content}
                messageTimestamp={message.timestamp}
                sourceContext={message.sourceContext}
                onVideoReady={handleVideoReady}
              />
            )}
          </div>
          <OutboundStatusBadges message={message} />
          <GeneratedImageAttachments images={generatedImages} />
          <GeneratedVideoAttachments videos={generatedVideos} />
        </div>
      )}
    </div>
  );
});

/* ─── Streaming indicator ─── */

const StreamingBubble = React.memo(function StreamingBubble({
  text,
  toolCalls,
}: {
  text: string;
  toolCalls: { name: string }[];
}) {
  return (
    <div className="flex gap-2">
      {/* Avatar */}
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-positive)]/15 text-[var(--color-positive)]">
        <Bot size={12} />
      </div>

      <div className="max-w-[88%] space-y-2">
        {/* Active tool calls */}
        {toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {toolCalls.slice(-3).map((tc, i) => (
              <span
                key={`${tc.name}-${i}`}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[8px] font-mono font-semibold uppercase tracking-wider"
                style={{
                  background: 'rgba(255, 170, 0, 0.1)',
                  color: 'var(--agent-thinking)',
                  border: '1px solid rgba(255, 170, 0, 0.2)',
                }}
              >
                <Zap size={8} className="animate-pulse" />
                {tc.name.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}

        {/* Streaming text */}
        {text && (
          <div
            className="px-3 py-2.5 text-[11px] font-mono leading-relaxed text-[var(--text-secondary)]"
            style={{
              background: 'var(--crt-panel-bg)',
              border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
              boxShadow: '0 0 6px rgba(var(--crt-glow-rgb), 0.05)',
            }}
          >
            <div className="break-words">{renderMarkdown(text)}</div>
            <span
              className="inline-block h-3 w-1.5 animate-pulse ml-0.5"
              style={{ background: 'var(--crt-glow)' }}
            />
          </div>
        )}

        {/* Thinking indicator when no text yet */}
        {!text && (
          <div
            className="px-3 py-2.5 text-[11px] font-mono"
            style={{
              background: 'var(--crt-panel-bg)',
              border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
              color: 'var(--text-dim)',
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--crt-glow)] animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--crt-glow)] animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--crt-glow)] animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
              Analyzing...
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

/* ─── AgentDrawer ─── */

/* ─── Proactive Max greeting (Phase 1E) ─── */
// Tier 1: a zero-LLM "since your last visit" delta from already-in-store data.
// Tier 2: "Brief me" prefills Max to summarize (the agent's posture sets depth).

function SessionDeltaGreeting() {
  const delta = useSessionDelta();
  if (!delta.sinceISO || delta.total === 0) return null;

  const parts: string[] = [];
  if (delta.newKev > 0) parts.push(`${delta.newKev} new KEV`);
  if (delta.newCriticalCves > 0)
    parts.push(`${delta.newCriticalCves} critical CVE${delta.newCriticalCves > 1 ? 's' : ''}`);
  if (delta.newBreaches > 0)
    parts.push(`${delta.newBreaches} breach${delta.newBreaches > 1 ? 'es' : ''}`);
  if (delta.newAlerts > 0) parts.push(`${delta.newAlerts} alert${delta.newAlerts > 1 ? 's' : ''}`);

  return (
    <div
      className="w-full max-w-[320px] rounded-md border p-3 text-left"
      style={{
        borderColor: 'rgba(var(--crt-glow-rgb), 0.2)',
        background: 'rgba(var(--crt-glow-rgb), 0.04)',
      }}
    >
      <p
        className="text-[10px] font-mono font-semibold uppercase tracking-wider"
        style={{ color: 'var(--crt-glow)' }}
      >
        Since your last visit
      </p>
      <p className="mt-1 text-[11px] font-mono text-[var(--text-secondary)]">{parts.join(' · ')}</p>
      <button
        type="button"
        onClick={() =>
          prefillAgent(
            'Summarize what changed since my last visit and what I should worry about today.',
            {
              sourcePanel: 'proactive',
              dataType: 'session_delta',
              trendData: {
                newKev: delta.newKev,
                newCriticalCves: delta.newCriticalCves,
                newBreaches: delta.newBreaches,
                newAlerts: delta.newAlerts,
                sinceISO: delta.sinceISO,
              },
            },
          )
        }
        className="mt-2 rounded border px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors hover:brightness-125"
        style={{ borderColor: 'rgba(var(--crt-glow-rgb), 0.3)', color: 'var(--crt-glow)' }}
      >
        Brief me →
      </button>
    </div>
  );
}

export function AgentDrawer() {
  const drawerOpen = useAgentStore((s) => s.drawerOpen);
  const setDrawerOpen = useAgentStore((s) => s.setDrawerOpen);
  const drawerFullscreen = useAgentStore((s) => s.drawerFullscreen);
  const setDrawerFullscreen = useAgentStore((s) => s.setDrawerFullscreen);
  const heroFullscreen = usePanelsStore((s) => s.heroFullscreen);
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const streamingText = useAgentStore((s) => s.streamingText);
  const toolCallLog = useAgentStore((s) => s.toolCallLog);
  const clearConversationBase = useAgentStore((s) => s.clearConversation);
  // Phase 14 — three-mode posture state drives the pill row and per-message chips.
  const lockedMode = useAgentStore((s) => s.lockedMode);
  const storeDetectedMode = useAgentStore((s) => s.detectedMode);
  const setLockedMode = useAgentStore((s) => s.setLockedMode);

  // Phase 14.5 (code-review fix #12) — derive the pill's `detectedMode`
  // from the latest agent-store message's stamped `agentMode` when we're
  // NOT streaming. The store's `detectedMode` is a transient, race-prone
  // value updated by every active stream — if the user has both the agent
  // drawer and the companion sidebar active, the last write wins regardless
  // of which actually owns the visible transcript. The message-derived
  // value is always consistent with what's rendered in the drawer.
  // During streaming, fall back to the store's `detectedMode` so the
  // pill updates in real time as the marker arrives.
  const pillDetectedMode = useMemo<AgentMode>(() => {
    if (isStreaming) return storeDetectedMode;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === 'assistant' && msg.agentMode) return msg.agentMode;
    }
    return storeDetectedMode;
  }, [isStreaming, messages, storeDetectedMode]);
  const { invoke, expand } = useAgentStream();
  const [matrixRainEnabled, setMatrixRainEnabled] = useState(true);
  // Poll ownership lives in a module-level registry shared with the stream
  // pollers (use-agent-stream / use-companion-stream), not in a component ref —
  // otherwise both loops chase the same render and every video poll costs a
  // duplicate provider round-trip.
  const activeXPostPollsRef = useRef<Set<string>>(new Set());
  const xPostJobs = useAgentStore((s) => s.xPostJobs);

  const [clearStatus, setClearStatus] = useState('');
  const clearConversation = useCallback(() => {
    clearConversationBase();
    useCompanionStore.getState().clearCompanionMessages();
    void fetch('/api/agent/context', { method: 'DELETE' })
      .then(async (response) => {
        if (!response.ok) throw new Error('not_confirmed');
        setClearStatus(
          (await response.json()).storageDeletion === 'pending'
            ? 'Context cleared. File cleanup is pending; see Private files.'
            : 'Context cleared.',
        );
      })
      .catch(() =>
        setClearStatus(
          'Server deletion was not confirmed. Retry clearing context or use Private files.',
        ),
      );
  }, [clearConversationBase]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom only while the user is already there — a render in
  // progress polls every ~2s and must not yank a scrolled-up reader down.
  const handleScroll = useStickToBottom(scrollRef, messages, streamingText);

  useEffect(() => {
    const pendingVideos = messages.flatMap((message, messageIndex) =>
      (message.generatedVideos ?? [])
        .filter(isPendingGeneratedVideo)
        .map((video) => ({ messageIndex, video })),
    );

    for (const { messageIndex, video } of pendingVideos) {
      const pollUrl = video.pollUrl;
      if (!pollUrl || !claimMediaPoll(video.generatedMediaId)) continue;

      void (async () => {
        try {
          for (let attempt = 0; attempt < VIDEO_POLL_ATTEMPTS; attempt += 1) {
            await delay(2000);
            const currentVideo = useAgentStore
              .getState()
              .messages[messageIndex]?.generatedVideos?.find(
                (item) => item.generatedMediaId === video.generatedMediaId,
              );
            if (!currentVideo || !isPendingGeneratedVideo(currentVideo)) return;

            try {
              const res = await fetch(pollUrl);
              // A 404 is terminal, not transient: the row is gone (purged, or a
              // stale pollUrl restored from localStorage after a db reset).
              // Retrying it 180 times just delays the spinner forever.
              if (res.status === 404) {
                useAgentStore.getState().addGeneratedVideoToMessage(messageIndex, {
                  ...currentVideo,
                  status: 'failed',
                  errorMessage: 'This render is no longer on the server.',
                  updatedAt: Date.now(),
                });
                return;
              }
              const data = (await res.json()) as GeneratedMediaStatusPayload;
              if (!res.ok || !data.ok) continue;
              const nextVideo = generatedVideoFromStatus(data, currentVideo);
              if (!nextVideo) continue;
              useAgentStore.getState().addGeneratedVideoToMessage(messageIndex, nextVideo);
              // 'ready' only counts as terminal once there is something to play —
              // matching use-agent-stream's condition, so the outcome doesn't
              // depend on which poller happened to win the claim.
              if (
                (nextVideo.status === 'ready' && Boolean(nextVideo.blobUrl)) ||
                nextVideo.status === 'failed'
              ) {
                return;
              }
            } catch {
              // The stream-level poller tolerates transient misses; mirror that here.
            }
          }

          // Ran out of attempts. Say so — previously the loop just exited and
          // the card claimed "render in progress" for the rest of the session.
          // Shared with the stream pollers so all three give up identically.
          markGeneratedVideoGaveUp(messageIndex, video.generatedMediaId);
        } finally {
          releaseMediaPoll(video.generatedMediaId);
        }
      })();
    }
  }, [messages]);

  // Same reload-safe resume poller for pending IMAGES. The IMG button now seeds a
  // pending attachment + closes (fire-and-forget, like VID), so this owns the
  // ~10-30s wait and swaps the PNG in inline — Max stays usable meanwhile.
  useEffect(() => {
    const pendingImages = messages.flatMap((message, messageIndex) =>
      (message.generatedImages ?? [])
        .filter(isPendingGeneratedImage)
        .map((image) => ({ messageIndex, image })),
    );

    for (const { messageIndex, image } of pendingImages) {
      const pollUrl = image.pollUrl;
      if (!pollUrl || !claimMediaPoll(image.generatedMediaId)) continue;

      void (async () => {
        try {
          for (let attempt = 0; attempt < 180; attempt += 1) {
            await delay(2000);
            const currentImage = useAgentStore
              .getState()
              .messages[messageIndex]?.generatedImages?.find(
                (item) => item.generatedMediaId === image.generatedMediaId,
              );
            if (!currentImage || !isPendingGeneratedImage(currentImage)) return;

            try {
              const res = await fetch(pollUrl);
              const data = (await res.json()) as GeneratedMediaStatusPayload;
              if (!res.ok || !data.ok) continue;
              const nextImage = generatedImageFromStatus(data, currentImage);
              if (!nextImage) continue;
              useAgentStore.getState().addGeneratedImageToMessage(messageIndex, nextImage);
              if (nextImage.status === 'ready' || nextImage.status === 'failed') return;
            } catch {
              // tolerate transient poll misses (mirror the video poller)
            }
          }
        } finally {
          releaseMediaPoll(image.generatedMediaId);
        }
      })();
    }
  }, [messages]);

  // Resume background X-post jobs after a reload — the server is the source of
  // truth, so re-hydrate the toast/poller from any still-active jobs.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/outbound/x/jobs', { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean; jobs?: XPostJobPayload[] };
        if (!data.ok || !Array.isArray(data.jobs)) return;
        const add = useAgentStore.getState().addXPostJob;
        for (const job of data.jobs) add(xPostPayloadToItem(job));
      } catch {
        // offline — last-known store still shows status
      }
    })();
  }, []);

  // Advance + track each non-terminal X-post job. The GET poll IS the worker, so
  // this single client loop both observes and drives the job to completion.
  useEffect(() => {
    for (const job of xPostJobs) {
      // Poll dismissed-but-active jobs too: dismissing only hides the toast (it
      // never cancels the post), so we keep driving the job and let its terminal
      // outcome re-surface the toast. Stop only once the job is actually terminal.
      if (isTerminalXPostStatus(job.status)) continue;
      if (activeXPostPollsRef.current.has(job.jobToken)) continue;
      activeXPostPollsRef.current.add(job.jobToken);

      void (async () => {
        try {
          for (let attempt = 0; attempt < 180; attempt += 1) {
            await delay(2000);
            const current = useAgentStore
              .getState()
              .xPostJobs.find((j) => j.jobToken === job.jobToken);
            if (!current || isTerminalXPostStatus(current.status)) return;
            try {
              const res = await fetch(job.pollUrl, { credentials: 'include' });
              const data = (await res.json()) as Partial<XPostJobPayload> & { ok?: boolean };
              if (!res.ok || data.ok === false || !data.status) continue;
              useAgentStore.getState().updateXPostJob(job.jobToken, {
                status: data.status,
                tweetIds: data.tweetIds ?? current.tweetIds,
                errorCode: data.errorCode ?? null,
                errorMessage: data.errorMessage ?? null,
              });
              // Stamp the originating Max message as posted — persists the
              // permalink so it survives reload (the toast is transient).
              if (data.status === 'posted' && current.messageTimestamp != null) {
                const rootId = data.tweetIds?.[0] ?? current.tweetIds[0];
                if (rootId) {
                  useAgentStore.getState().markMessagePostedToX(current.messageTimestamp, {
                    tweetId: rootId,
                    tweetUrl: data.tweetUrl ?? `https://x.com/i/status/${rootId}`,
                    postedAt: Date.now(),
                  });
                }
              }
              // Surface a generate-image post's infographic inline under its Max
              // message: once the server worker reports a generatedMediaId, seed a
              // pending attachment and let the existing image poller swap the PNG in.
              if (
                typeof data.generatedMediaId === 'string' &&
                data.generatedMediaId &&
                current.messageTimestamp != null
              ) {
                const mediaId = data.generatedMediaId;
                const targetTs = current.messageTimestamp;
                const msgs = useAgentStore.getState().messages;
                const idx = msgs.findIndex(
                  (m) => m.role === 'assistant' && m.timestamp === targetTs,
                );
                const already =
                  idx !== -1 &&
                  (msgs[idx]?.generatedImages ?? []).some((i) => i.generatedMediaId === mediaId);
                if (idx !== -1 && !already) {
                  useAgentStore.getState().addGeneratedImageToMessage(idx, {
                    generatedMediaId: mediaId,
                    status: 'pending',
                    pollUrl: `/api/outbound/generated-media/${mediaId}`,
                    createdAt: Date.now(),
                  });
                }
              }
              if (isTerminalXPostStatus(data.status)) return;
            } catch {
              // tolerate transient poll misses
            }
          }
        } finally {
          activeXPostPollsRef.current.delete(job.jobToken);
        }
      })();
    }
  }, [xPostJobs]);

  // Escape key — layered dismissal: exit fullscreen first, then close drawer
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && drawerOpen) {
        if (drawerFullscreen) {
          setDrawerFullscreen(false);
        } else {
          setDrawerOpen(false);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen, drawerFullscreen, setDrawerOpen, setDrawerFullscreen]);

  const handleQuickAction = useCallback(
    (query: string) => {
      invoke(query);
    },
    [invoke],
  );

  const handleExpand = useCallback(
    (messageIndex: number, originalText: string) => {
      expand(messageIndex, originalText);
    },
    [expand],
  );

  return (
    <div
      className={cn(
        'fixed right-0 flex flex-col overflow-hidden transition-transform duration-300 ease-out',
        drawerOpen ? 'translate-x-0' : 'translate-x-full',
      )}
      style={{
        top:
          drawerFullscreen && heroFullscreen
            ? '0'
            : 'calc(var(--header-height) + var(--top-ticker-height))',
        bottom:
          drawerFullscreen && heroFullscreen
            ? '0'
            : 'calc(var(--command-bar-height) + var(--bottom-ticker-height))',
        width: drawerFullscreen
          ? heroFullscreen
            ? '100vw'
            : 'calc(100vw - var(--sidebar-width))'
          : 'var(--agent-drawer-width)',
        zIndex: 'var(--z-agent-drawer)',
        background: 'var(--crt-panel-bg)',
        // Neon brand seam for the drawer edge.
        borderLeft: drawerFullscreen ? 'none' : '4px solid var(--brand-accent, #00ff41)',
        boxShadow: drawerFullscreen
          ? 'none'
          : 'inset 2px 0 0 0 var(--brand-accent, #00ff41), -8px 0 24px rgba(0, 0, 0, 0.4)',
        backdropFilter: drawerOpen ? 'blur(20px)' : 'none',
      }}
    >
      <MatrixRainBackdrop active={drawerOpen && drawerFullscreen && matrixRainEnabled} />

      {/* Header — CRT styled, matching the dashboard header seam */}
      <div
        className="relative z-[2] flex shrink-0 items-center justify-between px-4 py-3"
        style={{ borderBottom: '2px solid var(--brand-accent, #00ff41)' }}
      >
        <div className="flex items-center gap-2">
          <AgentStatusIndicator size={8} />
          <CocoaWordmark
            sigilSize={14}
            wordmarkSize={14}
            systemTagSize={9}
            systemTag={AGENT_IDENTITY.systemTag}
            gap={6}
          />
        </div>
        <div className="flex items-center gap-1">
          {drawerFullscreen && (
            <button
              type="button"
              onClick={() => setMatrixRainEnabled((enabled) => !enabled)}
              className={cn(
                'flex h-6 w-6 items-center justify-center transition-colors hover:text-[var(--crt-glow)]',
                matrixRainEnabled
                  ? 'bg-[rgba(var(--brand-accent-rgb),0.08)] text-[var(--brand-accent)] shadow-[0_0_8px_rgba(var(--brand-accent-rgb),0.18)]'
                  : 'text-[var(--text-dim)]',
              )}
              aria-label={matrixRainEnabled ? 'Disable Matrix rain' : 'Enable Matrix rain'}
              title={matrixRainEnabled ? 'Disable Matrix rain' : 'Enable Matrix rain'}
            >
              <Binary size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setDrawerFullscreen(!drawerFullscreen)}
            className="flex h-6 w-6 items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--crt-glow)]"
            aria-label={drawerFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title={drawerFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {drawerFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          {clearStatus && (
            <span role="status" className="text-xs">
              {clearStatus}
            </span>
          )}
          <button
            type="button"
            onClick={clearConversation}
            className="flex h-6 w-6 items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--crt-glow)]"
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="flex h-6 w-6 items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--crt-glow)]"
            aria-label="Close drawer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Three-mode posture pill row (Phase 14 — wired up).
          Lock toggle + detected-mode reflection from the agent store. See
          ModePillRow.tsx for the four visual states (locked / passive /
          escalated / inert) and src/lib/agent/mode-config.ts for the
          underlying state semantics. */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.32)',
          borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.08)',
        }}
      >
        <ModePillRow
          lockedMode={lockedMode}
          detectedMode={pillDetectedMode}
          onLockToggle={setLockedMode}
        />
      </div>

      {/* Approval Queue (Phase 9.1) — sits between posture pills and messages */}
      <div className="relative z-[2]">
        <ApprovalQueueSection />
      </div>

      {/* Messages — scrollable */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative z-[2] min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        <div className={cn('space-y-4', drawerFullscreen && 'mx-auto max-w-3xl')}>
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <SessionDeltaGreeting />
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full"
                style={{
                  background: 'rgba(var(--crt-glow-rgb), 0.08)',
                  border: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
                }}
              >
                <Bot size={24} style={{ color: 'var(--crt-glow)' }} />
              </div>
              <div>
                <p
                  className="text-xs font-mono font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--crt-glow)' }}
                >
                  {AGENT_IDENTITY.name}
                </p>
                <p className="mt-1 text-[10px] font-mono text-[var(--text-dim)] max-w-[280px]">
                  {AGENT_IDENTITY.name} is watching the board. {AGENT_IDENTITY.tagline}
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={`${msg.timestamp}-${i}`}
              message={msg}
              messageIndex={i}
              onExpand={handleExpand}
            />
          ))}

          {/* Streaming response */}
          {isStreaming && <StreamingBubble text={streamingText} toolCalls={toolCallLog} />}
        </div>
      </div>

      {/* Quick action chips */}
      <div
        className="relative z-[2] shrink-0 py-2"
        style={{ borderTop: '1px solid rgba(var(--crt-glow-rgb), 0.1)' }}
      >
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3">
          {AGENT_SUGGESTIONS.map((action) => (
            <button
              type="button"
              key={action.label}
              onClick={() => handleQuickAction(action.query)}
              disabled={isStreaming}
              className={cn(
                'shrink-0 rounded px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all',
                isStreaming
                  ? 'text-[var(--text-muted)] cursor-not-allowed'
                  : 'text-[var(--text-dim)] hover:text-[var(--crt-glow)]',
              )}
              style={{
                border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
                background: isStreaming ? 'transparent' : undefined,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';

import { Loader2, Twitter, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import type { GeneratedImageAttachment, GeneratedVideoAttachment } from '@/lib/store/agent-store';
import {
  effectiveTweetLength,
  X_LONGFORM_MAX_LENGTH,
  X_STANDARD_VISIBLE_CHARS,
} from '@/lib/twitter/length';
import { buildXPublishPackage } from '@/lib/twitter/publish-package';
import { STYLE_REGISTRY, STYLE_TAGS, type StyleTag } from '@/lib/visual/style-registry';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';

const CVE_ID_RE = /\bCVE-\d{4}-\d{4,7}\b/;

type PublishMode = 'single' | 'two_post';
// X allows one media kind per tweet, so the reply carries text, an image, or a
// video — never a mix. Video is attach-existing only (generate it first via the
// VID button); inline generation stays image-only since images render in ~30s.
type ReplyMode = 'text' | 'latest_image' | 'generate_image' | 'latest_video';
type VisualStyleChoice = 'auto' | StyleTag;

const VISUAL_STYLE_OPTIONS: Array<{ value: VisualStyleChoice; label: string }> = [
  { value: 'auto', label: 'Auto' },
  ...STYLE_TAGS.map((tag) => ({ value: tag, label: STYLE_REGISTRY[tag].label })),
];

interface PostToXButtonProps {
  messageContent: string;
  messageTimestamp: number;
  generatedImages?: GeneratedImageAttachment[];
  generatedVideos?: GeneratedVideoAttachment[];
  sourceContext?: VisualBriefSourceContext;
}

interface ComposeApiPayload {
  ok?: boolean;
  package?: {
    primaryText?: string;
    replyText?: string;
    sourceUrl?: string;
    sourceUrls?: string[];
    draftedBy?: string;
  };
  error?: string;
  detail?: string;
}

function extractCveId(content: string): string | null {
  const match = content.match(CVE_ID_RE);
  return match ? match[0] : null;
}

function formatXHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return 'the configured X account';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

async function readComposeJson(res: Response): Promise<ComposeApiPayload | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as ComposeApiPayload) : null;
  } catch {
    return {
      ok: false,
      error: 'invalid_json_response',
      detail: `HTTP ${res.status} returned a non-JSON response.`,
    };
  }
}

function latestImage(images: GeneratedImageAttachment[]): GeneratedImageAttachment | null {
  let latest: GeneratedImageAttachment | null = null;
  for (const image of images) {
    if (!image.blobUrl) continue; // only ready images are postable
    if (!latest || image.createdAt > latest.createdAt) latest = image;
  }
  return latest;
}

function latestVideo(videos: GeneratedVideoAttachment[]): GeneratedVideoAttachment | null {
  let latest: GeneratedVideoAttachment | null = null;
  for (const video of videos) {
    if (!video.blobUrl || video.status !== 'ready') continue; // only finished clips are postable
    if (!latest || video.createdAt > latest.createdAt) latest = video;
  }
  return latest;
}

export function PostToXButton({
  messageContent,
  messageTimestamp,
  generatedImages = [],
  generatedVideos = [],
  sourceContext,
}: PostToXButtonProps) {
  const defaultPackage = useMemo(
    () => buildXPublishPackage({ messageContent, sourceContext }),
    [messageContent, sourceContext],
  );
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => defaultPackage.primaryText);
  const [publishMode, setPublishMode] = useState<PublishMode>('two_post');
  const [replyMode, setReplyMode] = useState<ReplyMode>('text');
  const [replyText, setReplyText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postingStage, setPostingStage] = useState<string | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionReady, setConnectionReady] = useState(false);
  const [connectedHandle, setConnectedHandle] = useState<string | null>(null);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [visualStyleChoice, setVisualStyleChoice] = useState<VisualStyleChoice>('auto');
  const [needsConnect, setNeedsConnect] = useState(false);
  const [postedTweetIds, setPostedTweetIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draftedBy, setDraftedBy] = useState<'fallback' | 'llm'>('fallback');
  const cveId = useMemo(() => extractCveId(messageContent), [messageContent]);
  const attachedImage = useMemo(() => latestImage(generatedImages), [generatedImages]);
  const attachedVideo = useMemo(() => latestVideo(generatedVideos), [generatedVideos]);
  const sourceUrl = defaultPackage.sourceUrl;
  const primaryLength = text.length;
  const primaryRemaining = X_LONGFORM_MAX_LENGTH - primaryLength;
  const primaryOverLimit = primaryRemaining < 0;
  const primaryFeedLength = effectiveTweetLength(text);
  const primaryExceedsFeedPreview = primaryFeedLength > X_STANDARD_VISIBLE_CHARS;
  const replyLength = publishMode === 'two_post' ? replyText.length : 0;
  const replyRemaining = X_LONGFORM_MAX_LENGTH - replyLength;
  const replyOverLimit = publishMode === 'two_post' && replyRemaining < 0;
  const postContextLabel = connectedHandle
    ? `${formatXHandle(connectedHandle)} · ${publishMode === 'two_post' ? 'two-post thread' : 'one post'}`
    : cveId
      ? `entity: ${cveId}`
      : `${AGENT_IDENTITY.name} response`;
  const generatedStyleLabel =
    visualStyleChoice === 'auto'
      ? 'auto style'
      : `${STYLE_REGISTRY[visualStyleChoice].label.toLowerCase()} style`;

  const resetComposer = useCallback(() => {
    setText(defaultPackage.primaryText);
    setPublishMode('two_post');
    // Prefer an existing ready image, else a ready video, else text-only.
    setReplyMode(attachedImage ? 'latest_image' : attachedVideo ? 'latest_video' : 'text');
    setReplyText(defaultPackage.replyText);
    setError(null);
    setPostedTweetIds([]);
    setPostingStage(null);
    setConnectionReady(false);
    setConnectedHandle(null);
    setMissingScopes([]);
    setVisualStyleChoice('auto');
    setDraftedBy('fallback');
  }, [defaultPackage, attachedImage, attachedVideo]);

  const handleOpen = useCallback(async () => {
    resetComposer();
    setOpen(true);
    setCheckingConnection(true);
    try {
      const res = await fetch('/api/twitter/status', { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        connected?: boolean;
        handle?: string | null;
        missingScopes?: string[];
        error?: string;
      };
      if (json.error === 'unauthorized') {
        setError('Sign in required');
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error || `X status check failed (${res.status})`);
        return;
      }
      if (!json.connected) {
        setNeedsConnect(true);
        setOpen(false);
        return;
      }
      setConnectionReady(true);
      setConnectedHandle(json.handle ?? 'configured-account');
      setMissingScopes(Array.isArray(json.missingScopes) ? json.missingScopes : []);
      setPostingStage('Drafting long-form copy…');
      try {
        const composeRes = await fetch('/api/twitter/compose', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messageContent, sourceContext }),
        });
        const composeJson = await readComposeJson(composeRes);
        if (composeRes.ok && composeJson?.ok && composeJson.package?.primaryText) {
          setText(composeJson.package.primaryText);
          if (typeof composeJson.package.replyText === 'string') {
            setReplyText(composeJson.package.replyText);
          }
          setDraftedBy(composeJson.package.draftedBy === 'llm' ? 'llm' : 'fallback');
        }
      } catch (composeErr) {
        console.warn('[PostToXButton] long-form compose fallback:', composeErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'X status check failed');
    } finally {
      setCheckingConnection(false);
      setPostingStage(null);
    }
  }, [messageContent, resetComposer, sourceContext]);

  // Launch a reload-safe BACKGROUND post job, then close the modal immediately —
  // the compose/image-gen/publish all run server-side while Max stays usable.
  // Progress + completion surface via the global toast (see AgentToast); the
  // drawer poller advances the job. No inline image generation here: when
  // replyMode='generate_image' the server worker generates the infographic.
  const handleLaunch = useCallback(async () => {
    if (!connectionReady) {
      setError('Verify X connection first');
      return;
    }
    setPosting(true);
    setError(null);
    try {
      let imageBlobUrl: string | undefined;
      let videoBlobUrl: string | undefined;
      if (publishMode === 'two_post' && replyMode === 'latest_image') {
        if (!attachedImage) {
          setError('Generate an image first or switch to text-only reply');
          return;
        }
        imageBlobUrl = attachedImage.blobUrl;
      }
      if (publishMode === 'two_post' && replyMode === 'latest_video') {
        if (!attachedVideo) {
          setError('No ready video to attach — generate one with the VID button first');
          return;
        }
        videoBlobUrl = attachedVideo.blobUrl;
      }

      const res = await fetch('/api/outbound/x/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          messageTimestamp,
          publishMode,
          replyMode: publishMode === 'two_post' ? replyMode : 'text',
          replyText: publishMode === 'two_post' ? replyText : undefined,
          sourceUrl,
          styleTag:
            replyMode === 'generate_image' && visualStyleChoice !== 'auto'
              ? visualStyleChoice
              : undefined,
          imageBlobUrl,
          videoBlobUrl,
          alertEntityKind: cveId ? 'cve' : 'agent_message',
          alertEntityId: cveId ?? undefined,
          sourceContext,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        draftId?: number;
        jobToken?: string;
        status?: string;
        pollUrl?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json.ok || !json.draftId) {
        setError(json.detail || json.error || `HTTP ${res.status}`);
        return;
      }
      setPostingStage('Draft saved. Review it in the approval queue.');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setPosting(false);
    }
  }, [
    attachedImage,
    attachedVideo,
    connectionReady,
    cveId,
    messageTimestamp,
    publishMode,
    replyMode,
    replyText,
    sourceContext,
    sourceUrl,
    text,
    visualStyleChoice,
  ]);

  // Esc closes the modal (it can always be dismissed — the post runs in the
  // background regardless).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const needsMediaReconnect =
    publishMode === 'two_post' && replyMode !== 'text' && missingScopes.includes('media.write');

  if (needsConnect) {
    return (
      <a
        href="/api/twitter/oauth/start"
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-colors"
        style={{
          color: 'var(--matrix-green, #00ff41)',
          background: 'rgba(var(--crt-glow-rgb), 0.08)',
          border: '1px solid rgba(var(--crt-glow-rgb), 0.25)',
        }}
        title="Connect your X account so Cocoa AI can post on its behalf"
      >
        <Twitter size={8} />
        Connect X →
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-colors"
        style={{
          color: 'var(--matrix-green, #00ff41)',
          background: 'rgba(var(--crt-glow-rgb), 0.06)',
          border: '1px solid rgba(var(--crt-glow-rgb), 0.18)',
        }}
        title="Compose a one-post or two-post X package from this response"
      >
        <Twitter size={8} />
        Post to X
      </button>
      {open && (
        <div
          className="pointer-events-none fixed z-[60] flex justify-end"
          style={{
            top: 'calc(var(--header-height) + var(--top-ticker-height) + 8px)',
            right: 10,
            bottom: 'calc(var(--command-bar-height) + var(--bottom-ticker-height) + 8px)',
            width: 'min(400px, calc(100vw - 20px), calc(var(--agent-drawer-width) - 20px))',
          }}
        >
          <div
            role="dialog"
            aria-modal="false"
            aria-label="Post to X"
            className="pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-md"
            style={{
              background: 'var(--bg-primary, #0a0a0a)',
              border: '1px solid rgba(var(--crt-glow-rgb), 0.3)',
              boxShadow: '0 0 24px rgba(var(--crt-glow-rgb), 0.15)',
            }}
          >
            <div
              className="flex shrink-0 items-center justify-between px-3 py-2"
              style={{ borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.16)' }}
            >
              <div
                className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider"
                style={{ color: 'var(--matrix-green, #00ff41)' }}
              >
                <Twitter size={12} />
                Post to X
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 hover:bg-white/5"
                aria-label="Close"
              >
                <X size={14} style={{ color: 'var(--text-dim, #888)' }} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-3 grid grid-cols-2 gap-2">
                {(['single', 'two_post'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPublishMode(mode)}
                    disabled={posting || postedTweetIds.length > 0}
                    className="rounded px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider"
                    style={{
                      color:
                        publishMode === mode
                          ? 'var(--bg-primary, #0a0a0a)'
                          : 'var(--matrix-green, #00ff41)',
                      background:
                        publishMode === mode ? 'var(--matrix-green, #00ff41)' : 'transparent',
                      border: '1px solid rgba(var(--crt-glow-rgb), 0.32)',
                    }}
                  >
                    {mode === 'single' ? 'One post' : 'Two-post thread'}
                  </button>
                ))}
              </div>

              <label
                htmlFor="x-primary-post"
                className="mb-1 block text-[9px] font-mono uppercase tracking-wider"
                style={{ color: 'var(--text-dim, #888)' }}
              >
                Post 1
              </label>
              <textarea
                id="x-primary-post"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={posting || postedTweetIds.length > 0}
                rows={5}
                className="w-full resize-none rounded p-2 font-mono text-[11px] leading-snug outline-none"
                style={{
                  maxHeight: 128,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${
                    primaryOverLimit ? 'rgba(255, 68, 68, 0.5)' : 'rgba(var(--crt-glow-rgb), 0.2)'
                  }`,
                  color: 'var(--text-primary, #e8e8e8)',
                }}
              />
              <div className="mt-1 flex items-center justify-between gap-3 text-[10px] font-mono">
                <div className="min-w-0 truncate" style={{ color: 'var(--text-dim, #888)' }}>
                  {postContextLabel}
                </div>
                <div
                  className="shrink-0"
                  style={{
                    color: primaryOverLimit
                      ? 'var(--color-negative, #ff4444)'
                      : primaryRemaining < 500
                        ? 'var(--color-warning, #ffaa00)'
                        : 'var(--text-dim, #888)',
                  }}
                >
                  {primaryLength}/{X_LONGFORM_MAX_LENGTH}
                </div>
              </div>
              <div className="mt-1 text-[9px] font-mono" style={{ color: 'var(--text-dim, #888)' }}>
                {primaryExceedsFeedPreview
                  ? `first ${X_STANDARD_VISIBLE_CHARS} chars show in feed · long-form draft: ${draftedBy}`
                  : `${primaryFeedLength}/${X_STANDARD_VISIBLE_CHARS} visible-feed chars · draft: ${draftedBy}`}
              </div>

              {publishMode === 'two_post' && (
                <div className="mt-3">
                  <div className="mb-2 grid grid-cols-2 gap-1.5">
                    {[
                      ['text', 'Text only'],
                      ['latest_image', 'Use latest image'],

                      ['latest_video', 'Use latest video'],
                    ].map(([mode, label]) => {
                      const disabled =
                        posting ||
                        postedTweetIds.length > 0 ||
                        (mode === 'latest_image' && !attachedImage) ||
                        (mode === 'latest_video' && !attachedVideo);
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setReplyMode(mode as ReplyMode)}
                          disabled={disabled}
                          className="min-w-0 truncate rounded px-2 py-1.5 text-[9px] font-mono font-bold uppercase tracking-wider disabled:opacity-35"
                          style={{
                            color:
                              replyMode === mode
                                ? 'var(--bg-primary, #0a0a0a)'
                                : 'var(--matrix-green, #00ff41)',
                            background:
                              replyMode === mode ? 'var(--matrix-green, #00ff41)' : 'transparent',
                            border: '1px solid rgba(var(--crt-glow-rgb), 0.24)',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {replyMode === 'generate_image' && (
                    <div className="mb-2">
                      <label
                        htmlFor="x-visual-style"
                        className="mb-1 block text-[9px] font-mono uppercase tracking-wider"
                        style={{ color: 'var(--text-dim, #888)' }}
                      >
                        Visual style
                      </label>
                      <select
                        id="x-visual-style"
                        value={visualStyleChoice}
                        onChange={(e) => setVisualStyleChoice(e.target.value as VisualStyleChoice)}
                        disabled={posting || postedTweetIds.length > 0}
                        className="w-full rounded px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider outline-none"
                        style={{
                          color: 'var(--matrix-green, #00ff41)',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(var(--crt-glow-rgb), 0.24)',
                        }}
                      >
                        {VISUAL_STYLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <label
                    htmlFor="x-reply-post"
                    className="mb-1 block text-[9px] font-mono uppercase tracking-wider"
                    style={{ color: 'var(--text-dim, #888)' }}
                  >
                    Reply
                  </label>
                  <textarea
                    id="x-reply-post"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    disabled={posting || postedTweetIds.length > 0}
                    rows={3}
                    className="w-full resize-none rounded p-2 font-mono text-[11px] leading-snug outline-none"
                    style={{
                      maxHeight: 88,
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${
                        replyOverLimit
                          ? 'rgba(255, 68, 68, 0.5)'
                          : 'rgba(var(--crt-glow-rgb), 0.16)'
                      }`,
                      color: 'var(--text-primary, #e8e8e8)',
                    }}
                  />
                  <div className="mt-1 flex items-center justify-between gap-3 text-[10px] font-mono">
                    <div className="min-w-0 truncate" style={{ color: 'var(--text-dim, #888)' }}>
                      {replyMode === 'latest_image' && attachedImage
                        ? `image: ${attachedImage.styleTag?.replace(/_/g, ' ') ?? attachedImage.generatedMediaId}`
                        : replyMode === 'generate_image'
                          ? `image: generated before posting · ${generatedStyleLabel}`
                          : replyMode === 'latest_video' && attachedVideo
                            ? `video: ${attachedVideo.styleTag?.replace(/_/g, ' ') ?? attachedVideo.generatedMediaId} · uploads to X on post`
                            : 'no media attached'}
                    </div>
                    <div
                      className="shrink-0"
                      style={{
                        color: replyOverLimit
                          ? 'var(--color-negative, #ff4444)'
                          : replyRemaining < 500
                            ? 'var(--color-warning, #ffaa00)'
                            : 'var(--text-dim, #888)',
                      }}
                    >
                      {replyLength}/{X_LONGFORM_MAX_LENGTH}
                    </div>
                  </div>
                </div>
              )}

              <div
                className="mt-3 rounded p-2 text-[10px] font-mono"
                style={{
                  background: 'rgba(var(--crt-glow-rgb), 0.035)',
                  border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
                  color: 'var(--text-secondary, #b8b8b8)',
                }}
              >
                <div className="mb-1 uppercase tracking-wider text-[8px]">Preview</div>
                <div className="max-h-28 overflow-y-auto whitespace-pre-wrap">
                  1. {text || 'Post text'}
                </div>
                {publishMode === 'two_post' && (
                  <div className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap">
                    2. {replyText || 'Reply text'}
                    {(replyMode === 'latest_image' && attachedImage) ||
                    replyMode === 'generate_image' ? (
                      <span style={{ color: 'var(--matrix-green, #00ff41)' }}> + infographic</span>
                    ) : replyMode === 'latest_video' && attachedVideo ? (
                      <span style={{ color: 'var(--matrix-green, #00ff41)' }}> + video clip</span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div
              className="shrink-0 px-3 py-2"
              style={{ borderTop: '1px solid rgba(var(--crt-glow-rgb), 0.14)' }}
            >
              {needsMediaReconnect && (
                <div
                  className="mb-2 rounded px-2 py-1 text-[10px] font-mono"
                  style={{
                    background: 'rgba(255, 170, 0, 0.1)',
                    color: 'var(--color-warning, #ffaa00)',
                    border: '1px solid rgba(255, 170, 0, 0.25)',
                  }}
                  role="status"
                >
                  Reconnect X to grant media.write before posting image replies.{' '}
                  <a
                    href="/api/twitter/oauth/start"
                    className="font-bold underline underline-offset-2"
                    style={{ color: 'var(--matrix-green, #00ff41)' }}
                  >
                    Connect X
                  </a>
                </div>
              )}
              {checkingConnection && (
                <div
                  className="mb-2 rounded px-2 py-1 text-[10px] font-mono"
                  style={{
                    background: 'rgba(var(--crt-glow-rgb), 0.06)',
                    color: 'var(--matrix-green, #00ff41)',
                    border: '1px solid rgba(var(--crt-glow-rgb), 0.18)',
                  }}
                  role="status"
                >
                  Checking X connection…
                </div>
              )}
              {postingStage && (
                <div
                  className="mb-2 rounded px-2 py-1 text-[10px] font-mono"
                  style={{
                    background: 'rgba(var(--crt-glow-rgb), 0.06)',
                    color: 'var(--matrix-green, #00ff41)',
                    border: '1px solid rgba(var(--crt-glow-rgb), 0.18)',
                  }}
                  role="status"
                >
                  {postingStage}
                </div>
              )}
              {error && (
                <div
                  className="mb-2 rounded px-2 py-1 text-[10px] font-mono"
                  style={{
                    background: 'rgba(255, 68, 68, 0.1)',
                    color: 'var(--color-negative, #ff4444)',
                    border: '1px solid rgba(255, 68, 68, 0.25)',
                  }}
                  role="alert"
                >
                  {error}
                </div>
              )}
              {postedTweetIds.length > 0 && (
                <div
                  className="mb-2 rounded px-2 py-1 text-[10px] font-mono"
                  style={{
                    background: 'rgba(var(--crt-glow-rgb), 0.1)',
                    color: 'var(--matrix-green, #00ff41)',
                    border: '1px solid rgba(var(--crt-glow-rgb), 0.25)',
                  }}
                  role="status"
                >
                  Posted {postedTweetIds.length} post{postedTweetIds.length === 1 ? '' : 's'} (
                  {postedTweetIds.join(', ')})
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider"
                  style={{
                    color: 'var(--text-dim, #888)',
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={
                    posting ||
                    checkingConnection ||
                    !connectionReady ||
                    primaryOverLimit ||
                    replyOverLimit ||
                    needsMediaReconnect ||
                    text.trim().length === 0 ||
                    (publishMode === 'two_post' && replyText.trim().length === 0) ||
                    postedTweetIds.length > 0
                  }
                  className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider disabled:opacity-40"
                  style={{
                    color: 'var(--bg-primary, #0a0a0a)',
                    background: 'var(--matrix-green, #00ff41)',
                    border: '1px solid var(--matrix-green, #00ff41)',
                  }}
                >
                  {posting ? <Loader2 size={10} className="animate-spin" /> : <Twitter size={10} />}
                  {posting ? 'Staging…' : 'Save for approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

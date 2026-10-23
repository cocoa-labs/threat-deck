'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Twitter, X } from 'lucide-react';
import Image from 'next/image';
import { useMemo, useRef, useState } from 'react';
import { APPROVAL_QUEUE_KEY } from '@/lib/hooks/use-approval-queue';
import type { GeneratedImageAttachment, GeneratedVideoAttachment } from '@/lib/store/agent-store';
import { appendCanonicalHashtag } from '@/lib/twitter/content/format';
import {
  effectiveTweetLength,
  X_LONGFORM_MAX_LENGTH,
  X_STANDARD_VISIBLE_CHARS,
} from '@/lib/twitter/length';
import { buildTweetUrl } from '@/lib/twitter/permalink';
import { buildXPublishPackage } from '@/lib/twitter/publish-package';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';
import { GenerateImageButton } from './GenerateImageButton';

type PublishMode = 'single' | 'two_post';
interface PostToXButtonProps {
  messageContent: string;
  messageTimestamp: number;
  generatedImages?: GeneratedImageAttachment[];
  generatedVideos?: GeneratedVideoAttachment[];
  sourceContext?: VisualBriefSourceContext;
  onImageReady?: (image: GeneratedImageAttachment) => void;
}
interface ComposeApiPayload {
  ok?: boolean;
  package?: { primaryText?: string; replyText?: string; draftedBy?: string };
  error?: string;
  detail?: string;
}

async function readComposeJson(res: Response): Promise<ComposeApiPayload | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function PostToXButton({
  messageContent,
  messageTimestamp,
  generatedImages = [],
  generatedVideos = [],
  sourceContext,
  onImageReady,
}: PostToXButtonProps) {
  const queryClient = useQueryClient();
  const defaultPackage = useMemo(
    () => buildXPublishPackage({ messageContent, sourceContext }),
    [messageContent, sourceContext],
  );
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(defaultPackage.primaryText);
  const [replyText, setReplyText] = useState(defaultPackage.replyText);
  const [publishMode, setPublishMode] = useState<PublishMode>('single');
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [startedImage, setStartedImage] = useState<GeneratedImageAttachment | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [connection, setConnection] = useState('Checking X connection…');
  const [needsConnect, setNeedsConnect] = useState(false);
  const [xDisabled, setXDisabled] = useState(false);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [publicationAttempted, setPublicationAttempted] = useState(false);
  const [savedDraft, setSavedDraft] = useState<{ id: number; key: string } | null>(null);
  const [outcome, setOutcome] = useState<{
    message: string;
    tweetIds: string[];
    published: boolean;
  } | null>(null);
  const initialized = useRef(false);
  const observedLatestMediaId = useRef<string | null>(null);
  const submitting = useRef(false);
  const latestImage =
    generatedImages.filter((image) => image.status !== 'failed').at(-1) ?? startedImage;
  const latestVideo = generatedVideos
    .filter((video) => video.status === 'ready' && video.blobUrl)
    .at(-1);
  const selectedImage =
    generatedImages.find((image) => image.generatedMediaId === selectedMediaId) ??
    (startedImage?.generatedMediaId === selectedMediaId ? startedImage : null);
  const selectedVideo = generatedVideos.find((video) => video.generatedMediaId === selectedMediaId);
  const selectedMedia = selectedImage ?? selectedVideo;
  const mediaReady = Boolean(
    selectedMedia?.blobUrl &&
      selectedMedia.status !== 'pending' &&
      selectedMedia.status !== 'failed',
  );
  const invalidMedia = selectedMediaId !== null && !mediaReady;
  const postText = appendCanonicalHashtag(text.trim());
  const tooLong =
    postText.length > X_LONGFORM_MAX_LENGTH ||
    (publishMode === 'two_post' && replyText.length > X_LONGFORM_MAX_LENGTH);
  const locked = saving || publicationAttempted;
  // This is exactly the content visible in the composer, including its attachment.
  // The approval endpoint atomically compares it with the stored draft.
  const reviewedPayload = {
    canonicalHashtag: '#AICyber',
    tweets: [
      { text: postText },
      ...(publishMode === 'two_post' ? [{ text: replyText.trim() }] : []),
    ],
    ...(selectedMediaId
      ? { mediaId: selectedMediaId, mediaKind: selectedImage ? 'image' : 'video' }
      : {}),
  };
  const payloadKey = JSON.stringify(reviewedPayload);
  const alreadySaved = savedDraft?.key === payloadKey;
  const cannotSave =
    locked ||
    xDisabled ||
    drafting ||
    invalidMedia ||
    tooLong ||
    !text.trim() ||
    (publishMode === 'two_post' && !replyText.trim());
  const cannotPublish =
    cannotSave ||
    !connected ||
    missingScopes.includes('tweet.write') ||
    (selectedMediaId !== null && missingScopes.includes('media.write'));

  const handleOpen = async () => {
    setOpen(true);
    if (publicationAttempted) return;
    const latestId = latestImage?.generatedMediaId ?? latestVideo?.generatedMediaId ?? null;
    if (!initialized.current || latestId !== observedLatestMediaId.current) {
      setSelectedMediaId(latestId);
      observedLatestMediaId.current = latestId;
    }
    if (!initialized.current) {
      initialized.current = true;
      setText(defaultPackage.primaryText);
      setReplyText(defaultPackage.replyText);
    }
    setError(null);
    setConnected(false);
    setNeedsConnect(false);
    setXDisabled(false);
    setMissingScopes([]);
    setConnection('Checking X connection…');
    try {
      const response = await fetch('/api/twitter/status', { credentials: 'include' });
      const status = await response.json();
      if (status.error === 'capability_disabled:x') {
        setXDisabled(true);
        setConnection(
          'X publishing is disabled for this installation. Enable it in the server configuration to connect an account and save drafts.',
        );
        return;
      }
      if (!response.ok || !status.ok)
        throw new Error('Could not check the X connection. You can still prepare a draft.');
      setNeedsConnect(!status.connected);
      setConnected(Boolean(status.connected));
      setDryRun(Boolean(status.dryRun));
      setMissingScopes(Array.isArray(status.missingScopes) ? status.missingScopes : []);
      setConnection(
        status.connected
          ? `Connected to ${String(status.handle || 'your X account').replace(/^@?/, '@')}`
          : 'Connect X before publishing. You can prepare and save your draft first.',
      );
    } catch (err) {
      setConnection(err instanceof Error ? err.message : 'Could not check the X connection.');
    }
  };

  // Rewriting is explicit: opening the composer never overwrites operator edits.
  const refine = async () => {
    setDrafting(true);
    setError(null);
    try {
      const response = await fetch('/api/twitter/compose', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageContent, sourceContext }),
      });
      const data = await readComposeJson(response);
      if (!response.ok || !data?.ok || !data.package?.primaryText)
        throw new Error(
          data?.detail ||
            data?.error ||
            'Could not draft the post. Your current text is unchanged.',
        );
      setText(data.package.primaryText);
      if (typeof data.package.replyText === 'string') setReplyText(data.package.replyText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft the post.');
    } finally {
      setDrafting(false);
    }
  };

  const imageStarted = (image: GeneratedImageAttachment) => {
    setStartedImage(image);
    setSelectedMediaId(image.generatedMediaId);
    observedLatestMediaId.current = image.generatedMediaId;
    onImageReady?.(image);
  };

  const submit = async (publish: boolean) => {
    if (submitting.current || (publish ? cannotPublish : cannotSave)) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    let approvalSent = false;
    try {
      let draftId = alreadySaved ? savedDraft.id : null;
      if (draftId === null) {
        const response = await fetch('/api/outbound/x/review', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: postText,
            messageTimestamp,
            publishMode,
            replyText: publishMode === 'two_post' ? replyText : undefined,
            replyMode: selectedImage ? 'latest_image' : selectedVideo ? 'latest_video' : 'text',
            imageBlobUrl: selectedImage?.blobUrl,
            videoBlobUrl: selectedVideo?.blobUrl,
            sourceUrl: defaultPackage.sourceUrl,
            sourceContext,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok || !Number.isSafeInteger(data.draftId) || data.draftId <= 0)
          throw new Error(
            data.detail || data.error || `Could not save draft (${response.status}).`,
          );
        draftId = data.draftId as number;
        setSavedDraft({ id: draftId, key: payloadKey });
      }
      if (!publish) return;
      // The operator's Post to X click approves the displayed content. Keep the
      // existing server approval, ownership, and duplicate-send protections.
      approvalSent = true;
      setPublicationAttempted(true);
      const response = await fetch(`/api/outbound/drafts/${draftId}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publish: true, reviewedPayload }),
      });
      const result = await response.json();
      const tweetIds = (result.tweetIds ?? result.partial?.tweetIds ?? []).filter(
        (id: unknown): id is string => typeof id === 'string' && /^\d+$/.test(id),
      );
      if (response.ok && result.ok && result.status === 'published' && result.dryRun) {
        setOutcome({
          message: 'Test completed. Nothing was posted to X.',
          tweetIds: [],
          published: false,
        });
      } else if (response.ok && result.ok && result.status === 'published' && tweetIds.length > 0) {
        setOutcome({
          message: publishMode === 'single' ? 'Posted to X.' : 'Thread posted to X.',
          tweetIds,
          published: true,
        });
      } else {
        const detail = result.detail || result.error;
        setOutcome({
          message: `${tweetIds.length ? `${tweetIds.length} post(s) sent, but the thread did not finish.` : 'Posting was not confirmed.'} ${typeof detail === 'string' ? detail : ''} Check X before trying again; this attempt will not be automatically resent.`,
          tweetIds,
          published: false,
        });
      }
    } catch (err) {
      if (approvalSent) {
        setOutcome({
          message:
            'The connection ended before X confirmed the result. Check your X account before trying again; this attempt will not be automatically resent.',
          tweetIds: [],
          published: false,
        });
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not save the draft. Nothing was posted.',
        );
      }
    } finally {
      setSaving(false);
      submitting.current = false;
      void queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          onClick={handleOpen}
          className="inline-flex min-h-7 items-center gap-1.5 rounded border border-[var(--crt-glow)]/25 bg-[var(--crt-glow)]/5 px-2 py-1 font-mono text-[11px] text-[var(--crt-glow)] hover:bg-[var(--crt-glow)]/10"
          title="Create an X post with text, an image, or a video"
        >
          <Twitter size={12} aria-hidden /> {outcome?.published ? 'Posted to X' : 'Post to X'}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-black/70"
          style={{ zIndex: 'calc(var(--z-agent-drawer) + 15)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--crt-glow)]/30 bg-[var(--bg-primary)] font-mono text-[var(--text-primary)] shadow-2xl"
          style={{ zIndex: 'calc(var(--z-agent-drawer) + 16)' }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] p-4">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-[var(--crt-glow)]">
                <Twitter size={16} aria-hidden />
                Post to X
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-[var(--text-dim)]">
                Check your text and attachment, then post directly to your connected X account.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={saving}
                aria-label="Close X composer"
                className="rounded p-1 hover:bg-[var(--bg-hover)]"
              >
                <X size={16} aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 text-xs">
            <p role="status" className="text-[var(--text-dim)]">
              {connection}{' '}
              {needsConnect && (
                <a className="underline text-[var(--crt-glow)]" href="/api/twitter/oauth/start">
                  Connect X
                </a>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {(['single', 'two_post'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={publishMode === mode}
                  onClick={() => setPublishMode(mode)}
                  disabled={locked}
                  className="rounded border border-[var(--border-subtle)] px-3 py-2 aria-pressed:border-[var(--crt-glow)] aria-pressed:text-[var(--crt-glow)]"
                >
                  {mode === 'single' ? 'One post' : 'Two-post thread'}
                </button>
              ))}
              <button
                type="button"
                onClick={refine}
                disabled={drafting || locked}
                className="ml-auto rounded border border-[var(--border-subtle)] px-3 py-2 text-[var(--crt-glow)]"
              >
                {drafting ? 'Drafting…' : 'Refine with Max'}
              </button>
            </div>
            <label className="block space-y-2">
              <span>Post {publishMode === 'two_post' ? '1' : 'text'}</span>
              <textarea
                aria-label="Post text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                disabled={locked || drafting}
                rows={6}
                className="w-full resize-y rounded border border-[var(--border-subtle)] bg-black/30 p-3 text-sm leading-relaxed"
              />
            </label>
            {postText !== text.trim() && (
              <p className="text-[var(--text-dim)]">Added to your post: #AICyber</p>
            )}
            <p className="text-[var(--text-dim)]">
              {postText.length.toLocaleString()} / {X_LONGFORM_MAX_LENGTH.toLocaleString()}{' '}
              characters ·{' '}
              {effectiveTweetLength(postText) > X_STANDARD_VISIBLE_CHARS
                ? 'Long posts require an eligible X account.'
                : 'Fits the standard post length.'}
            </p>
            {publishMode === 'two_post' && (
              <label className="block space-y-2">
                <span>Reply text</span>
                <textarea
                  aria-label="Reply text"
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  disabled={locked || drafting}
                  rows={3}
                  className="w-full resize-y rounded border border-[var(--border-subtle)] bg-black/30 p-3 text-sm leading-relaxed"
                />
              </label>
            )}
            <section
              aria-label="Post image or video"
              className="space-y-3 rounded border border-[var(--border-subtle)] p-3"
            >
              <h3 className="font-semibold">Image or video</h3>
              <p className="text-[var(--text-dim)]">
                {publishMode === 'two_post'
                  ? 'The attachment goes on the reply.'
                  : 'The attachment goes on your post.'}{' '}
                It will be included when you click Post to X.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={selectedMediaId === null}
                  onClick={() => setSelectedMediaId(null)}
                  disabled={locked}
                  className="rounded border border-[var(--border-subtle)] px-2 py-1.5 aria-pressed:text-[var(--crt-glow)]"
                >
                  No attachment
                </button>
                {latestImage && (
                  <button
                    type="button"
                    aria-pressed={selectedMediaId === latestImage.generatedMediaId}
                    onClick={() => setSelectedMediaId(latestImage.generatedMediaId)}
                    disabled={locked}
                    className="rounded border border-[var(--border-subtle)] px-2 py-1.5 aria-pressed:text-[var(--crt-glow)]"
                  >
                    Use latest image
                  </button>
                )}
                {latestVideo && (
                  <button
                    type="button"
                    aria-pressed={selectedMediaId === latestVideo.generatedMediaId}
                    onClick={() => setSelectedMediaId(latestVideo.generatedMediaId)}
                    disabled={locked}
                    className="rounded border border-[var(--border-subtle)] px-2 py-1.5 aria-pressed:text-[var(--crt-glow)]"
                  >
                    Use latest video
                  </button>
                )}
                <GenerateImageButton
                  messageContent={messageContent}
                  messageTimestamp={messageTimestamp}
                  sourceContext={sourceContext}
                  onImageReady={imageStarted}
                  disabled={locked}
                />
              </div>
              {selectedImage && mediaReady && (
                <Image
                  src={selectedImage.blobUrl!}
                  alt="Image attached to your X draft"
                  width={640}
                  height={360}
                  unoptimized
                  className="max-h-64 w-full rounded object-contain"
                />
              )}
              {selectedVideo && mediaReady && (
                <a
                  className="block underline text-[var(--crt-glow)]"
                  href={selectedVideo.blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Preview attached video
                </a>
              )}
              {invalidMedia && (
                <p role="status" className="text-[var(--severity-medium)]">
                  {selectedMedia?.status === 'failed'
                    ? `Image generation failed${selectedMedia.errorMessage ? `: ${selectedMedia.errorMessage}` : '.'} Create another image or choose No attachment.`
                    : 'Creating your image… You can keep editing. Review the image here when it is ready.'}
                </p>
              )}
              {selectedMediaId && missingScopes.includes('media.write') && (
                <p className="text-[var(--severity-medium)]">
                  Reconnect X to allow media uploads before publishing.{' '}
                  <a href="/api/twitter/oauth/start" className="underline">
                    Reconnect X
                  </a>
                </p>
              )}
            </section>
          </div>
          <footer className="shrink-0 space-y-2 border-t border-[var(--border-subtle)] p-4 text-xs">
            {error && (
              <p role="alert" className="text-[var(--severity-high)]">
                {error}
              </p>
            )}
            {tooLong && (
              <p role="alert" className="text-[var(--severity-high)]">
                Shorten the post or reply to {X_LONGFORM_MAX_LENGTH.toLocaleString()} characters.
              </p>
            )}
            {outcome && (
              <div role="status" className="space-y-2">
                <p>{outcome.message}</p>
                {outcome.tweetIds.map((id, index) => (
                  <a
                    key={id}
                    className="block text-[var(--crt-glow)] underline"
                    href={buildTweetUrl(id)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {outcome.tweetIds.length === 1
                      ? 'View post on X'
                      : `View post ${index + 1} on X`}
                  </a>
                ))}
              </div>
            )}
            {!outcome && alreadySaved && !saving && (
              <p role="status">Saved for later. Not posted.</p>
            )}
            {dryRun && !outcome && (
              <p role="status">Test mode is enabled. This will not publish a real post.</p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-3">
              {outcome ? (
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded border border-[var(--crt-glow)] px-3 py-2"
                  >
                    Done
                  </button>
                </Dialog.Close>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void submit(false)}
                    disabled={cannotSave || alreadySaved}
                    className="rounded border border-[var(--border-subtle)] px-3 py-2 disabled:opacity-40"
                  >
                    Save for later
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit(true)}
                    disabled={cannotPublish}
                    className="inline-flex shrink-0 items-center gap-2 rounded bg-[var(--crt-glow)] px-3 py-2 text-black disabled:opacity-40"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" aria-hidden />}
                    {saving ? 'Working…' : dryRun ? 'Test post (not public)' : 'Post to X'}
                  </button>
                </>
              )}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

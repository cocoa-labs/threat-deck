'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Twitter, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import { APPROVAL_QUEUE_KEY, OPEN_APPROVAL_QUEUE_EVENT } from '@/lib/hooks/use-approval-queue';
import type { GeneratedImageAttachment, GeneratedVideoAttachment } from '@/lib/store/agent-store';
import {
  effectiveTweetLength,
  X_LONGFORM_MAX_LENGTH,
  X_STANDARD_VISIBLE_CHARS,
} from '@/lib/twitter/length';
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
  const [publishMode, setPublishMode] = useState<PublishMode>('two_post');
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [startedImage, setStartedImage] = useState<GeneratedImageAttachment | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [connection, setConnection] = useState('Checking X connection…');
  const [needsConnect, setNeedsConnect] = useState(false);
  const [xDisabled, setXDisabled] = useState(false);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
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
  const tooLong =
    text.length > X_LONGFORM_MAX_LENGTH ||
    (publishMode === 'two_post' && replyText.length > X_LONGFORM_MAX_LENGTH);

  const handleOpen = useCallback(async () => {
    setText(defaultPackage.primaryText);
    setReplyText(defaultPackage.replyText);
    setPublishMode('two_post');
    setSelectedMediaId(latestImage?.generatedMediaId ?? latestVideo?.generatedMediaId ?? null);
    setError(null);
    setNeedsConnect(false);
    setXDisabled(false);
    setMissingScopes([]);
    setConnection('Checking X connection…');
    setOpen(true);
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
      setMissingScopes(Array.isArray(status.missingScopes) ? status.missingScopes : []);
      setConnection(
        status.connected
          ? `Connected to ${String(status.handle || 'your X account').replace(/^@?/, '@')}`
          : 'Connect X before publishing. You can prepare and save your draft first.',
      );
    } catch (err) {
      setConnection(err instanceof Error ? err.message : 'Could not check the X connection.');
    }
  }, [defaultPackage, latestImage, latestVideo]);

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
    onImageReady?.(image);
  };

  const save = async () => {
    if (
      saving ||
      xDisabled ||
      invalidMedia ||
      tooLong ||
      !text.trim() ||
      (publishMode === 'two_post' && !replyText.trim())
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/outbound/x/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
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
      if (!response.ok || !data.ok || !data.draftId)
        throw new Error(data.detail || data.error || `Could not save draft (${response.status}).`);
      await queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
      setOpen(false);
      requestAnimationFrame(() =>
        window.dispatchEvent(
          new CustomEvent(OPEN_APPROVAL_QUEUE_EVENT, { detail: { draftId: data.draftId } }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the draft.');
    } finally {
      setSaving(false);
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
          <Twitter size={12} aria-hidden /> Post to X
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
                Create your post and image, then review the saved draft before publishing.
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
                  disabled={saving}
                  className="rounded border border-[var(--border-subtle)] px-3 py-2 aria-pressed:border-[var(--crt-glow)] aria-pressed:text-[var(--crt-glow)]"
                >
                  {mode === 'single' ? 'One post' : 'Two-post thread'}
                </button>
              ))}
              <button
                type="button"
                onClick={refine}
                disabled={drafting || saving}
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
                disabled={saving || drafting}
                rows={6}
                className="w-full resize-y rounded border border-[var(--border-subtle)] bg-black/30 p-3 text-sm leading-relaxed"
              />
            </label>
            <p className="text-[var(--text-dim)]">
              {text.length.toLocaleString()} / {X_LONGFORM_MAX_LENGTH.toLocaleString()} characters ·{' '}
              {effectiveTweetLength(text) > X_STANDARD_VISIBLE_CHARS
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
                  disabled={saving || drafting}
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
                Generated media stays private until you approve publication.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={selectedMediaId === null}
                  onClick={() => setSelectedMediaId(null)}
                  disabled={saving}
                  className="rounded border border-[var(--border-subtle)] px-2 py-1.5 aria-pressed:text-[var(--crt-glow)]"
                >
                  No attachment
                </button>
                {latestImage && (
                  <button
                    type="button"
                    aria-pressed={selectedMediaId === latestImage.generatedMediaId}
                    onClick={() => setSelectedMediaId(latestImage.generatedMediaId)}
                    disabled={saving}
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
                    disabled={saving}
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
                  disabled={saving}
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
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-dim)]">
                Nothing is published until you approve.
              </span>
              <button
                type="button"
                onClick={save}
                disabled={
                  saving ||
                  xDisabled ||
                  drafting ||
                  invalidMedia ||
                  tooLong ||
                  !text.trim() ||
                  (publishMode === 'two_post' && !replyText.trim())
                }
                className="inline-flex shrink-0 items-center gap-2 rounded bg-[var(--crt-glow)] px-3 py-2 text-black disabled:opacity-40"
              >
                {saving && <Loader2 size={12} className="animate-spin" aria-hidden />}
                {saving ? 'Saving…' : 'Review draft'}
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

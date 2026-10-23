'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  OPEN_APPROVAL_QUEUE_EVENT,
  useApprovalQueue,
  useApproveDraft,
  useEditDraft,
  useRejectDraft,
} from '@/lib/hooks/use-approval-queue';
import type { DraftRow } from '@/lib/outbound/drafts';
import { buildTweetUrl } from '@/lib/twitter/permalink';
import { ApprovalQueueRow } from './ApprovalQueueRow';

/** Keep publications available without taking space from Max's conversation. */
export function ApprovalQueueSection() {
  const { data, isLoading, isFetching, isError, refetch } = useApprovalQueue();
  const approve = useApproveDraft();
  const reject = useRejectDraft();
  const edit = useEditDraft();
  const [open, setOpen] = useState(false);
  const [requestedDraftId, setRequestedDraftId] = useState<number | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [lastResult, setLastResult] = useState<ApproveOutcome | null>(null);
  // Severity ordering can put a newly saved draft beyond the first queue page.
  // Fetch that exact draft so Review draft always opens the publication just saved.
  const requested = useQuery({
    queryKey: ['requested-publication', requestedDraftId],
    enabled:
      open && requestedDraftId != null && !data?.some((draft) => draft.id === requestedDraftId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<DraftRow> => {
      const response = await fetch(`/api/outbound/drafts/${requestedDraftId}`, {
        credentials: 'include',
      });
      const body = await response.json();
      if (
        !response.ok ||
        body.draft?.id !== requestedDraftId ||
        !['drafted', 'edited'].includes(body.draft.status)
      )
        throw new Error(
          'This draft could not be opened for review. Refresh to check its current status.',
        );
      return body.draft;
    },
  });
  const pending = data ?? [];
  const drafts =
    requested.data &&
    requested.data.id === requestedDraftId &&
    !pending.some((draft) => draft.id === requestedDraftId)
      ? [requested.data, ...pending]
      : pending;
  const count = drafts.length;

  useEffect(() => {
    function openReview(event: Event) {
      const id = (event as CustomEvent<{ draftId?: number }>).detail?.draftId;
      setRequestedDraftId(typeof id === 'number' ? id : null);
      setOpen(true);
    }
    window.addEventListener(OPEN_APPROVAL_QUEUE_EVENT, openReview);
    return () => window.removeEventListener(OPEN_APPROVAL_QUEUE_EVENT, openReview);
  }, []);

  function setPending(id: number, isPending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setRequestedDraftId(null);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={
            isError ? 'Review drafts (refresh unavailable)' : `Review drafts (${count} pending)`
          }
          title="Review publication drafts"
          className="mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded border border-[var(--border-subtle)] px-2 font-mono text-[10px] text-[var(--text-secondary)] hover:border-[var(--crt-glow)] hover:text-[var(--crt-glow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--crt-glow)]"
        >
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" aria-hidden />
          ) : (
            <FileText size={12} aria-hidden />
          )}
          Unsent
          <span className="text-[var(--crt-glow)]">{isError ? '!' : count}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-black/70"
          style={{ zIndex: 'calc(var(--z-agent-drawer) + 10)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 flex max-h-[80dvh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--crt-glow)]/30 bg-[var(--bg-primary)] font-mono text-[var(--text-primary)] shadow-2xl"
          style={{ zIndex: 'calc(var(--z-agent-drawer) + 11)' }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] p-4">
            <div>
              <Dialog.Title className="text-sm font-semibold text-[var(--crt-glow)]">
                Publication drafts
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-[var(--text-dim)]">
                These are saved drafts, not sent posts. Open a draft to finish it; nothing here
                publishes automatically.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close draft review"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]"
              >
                <X size={16} aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          {lastResult && (
            <output
              className="block shrink-0 border-b border-[var(--border-subtle)] px-4 py-3 text-xs"
              style={{
                color:
                  lastResult.kind === 'posted'
                    ? 'var(--severity-low)'
                    : lastResult.kind === 'dryrun'
                      ? 'var(--severity-medium)'
                      : 'var(--severity-high)',
              }}
              aria-live="polite"
            >
              {lastResult.message}
              {lastResult.tweetIds?.map((id, index) => (
                <a
                  key={id}
                  className="mt-2 block underline"
                  href={buildTweetUrl(id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View post {index + 1} on X
                </a>
              ))}
              {lastResult.reconnect && (
                <a href="/api/twitter/oauth/start" className="ml-2 underline">
                  Reconnect X →
                </a>
              )}
            </output>
          )}
          {isError && (
            <p role="alert" className="shrink-0 px-4 py-3 text-xs text-[var(--severity-medium)]">
              Could not refresh drafts. Your saved drafts have not been changed.
              <button
                type="button"
                className="ml-2 underline"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {requested.isError && (
            <p role="alert" className="px-4 py-3 text-xs text-[var(--severity-medium)]">
              {requested.error.message}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => void requested.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {count > 0 ? (
            <ul
              aria-label="Pending publications"
              className="min-h-0 flex-1 list-none overflow-y-auto overscroll-contain px-4 py-2"
            >
              {[...drafts]
                .sort(
                  (a, b) => Number(b.id === requestedDraftId) - Number(a.id === requestedDraftId),
                )
                .map((draft) => (
                  <ApprovalQueueRow
                    key={`${draft.id}-${draft.id === requestedDraftId}`}
                    draft={draft}
                    isPending={pendingIds.has(draft.id)}
                    autoReview={draft.id === requestedDraftId}
                    onApprove={async (reviewedPayload) => {
                      setPending(draft.id, true);
                      try {
                        const res = await approve.mutateAsync({ id: draft.id, reviewedPayload });
                        if (requestedDraftId === draft.id) setRequestedDraftId(null);
                        setLastResult(
                          res.dryRun
                            ? {
                                kind: 'dryrun',
                                message:
                                  'Dry-run — not actually posted. (Dev is dry-run unless live posting is enabled.)',
                              }
                            : {
                                kind: 'posted',
                                message:
                                  draft.channel === 'email'
                                    ? 'Email sent to the reviewed recipients.'
                                    : `Posted to X ✓ — ${res.tweetIds?.length ?? 0} tweet${
                                        (res.tweetIds?.length ?? 0) === 1 ? '' : 's'
                                      }.`,
                                tweetIds: res.tweetIds?.filter((id) => /^\d+$/.test(id)),
                              },
                        );
                      } catch (err) {
                        const reason = err instanceof Error ? err.message : 'unknown';
                        setLastResult({
                          kind: 'error',
                          message: friendlyApproveError(reason),
                          reconnect: reason === 'no_token',
                        });
                      } finally {
                        setPending(draft.id, false);
                      }
                    }}
                    onReject={async (reason) => {
                      setPending(draft.id, true);
                      try {
                        await reject.mutateAsync({ id: draft.id, reason });
                        if (requestedDraftId === draft.id) setRequestedDraftId(null);
                      } catch (err) {
                        console.warn('[approval-queue] reject failed', err);
                      } finally {
                        setPending(draft.id, false);
                      }
                    }}
                    onEdit={async (draftPayload) => {
                      setPending(draft.id, true);
                      try {
                        await edit.mutateAsync({ id: draft.id, draftPayload });
                      } finally {
                        setPending(draft.id, false);
                      }
                    }}
                  />
                ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-sm text-[var(--text-dim)]">
              {isLoading || requested.isFetching
                ? 'Loading drafts…'
                : isError
                  ? 'Drafts are temporarily unavailable.'
                  : 'No publications waiting for review.'}
            </p>
          )}
          <footer className="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3 text-xs">
            <span className="flex items-center gap-2 text-[var(--text-dim)]">
              {count} unsent
              {isFetching && (
                <Loader2 size={12} className="animate-spin" aria-label="Refreshing drafts" />
              )}
            </span>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded border border-[var(--border-subtle)] px-3 py-1.5 hover:border-[var(--crt-glow)] hover:text-[var(--crt-glow)]"
              >
                Back to Max
              </button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type ApproveOutcome = {
  kind: 'posted' | 'dryrun' | 'error';
  message: string;
  /** When true, show a "Reconnect X" link (token expired/revoked). */
  reconnect?: boolean;
  tweetIds?: string[];
};

/** Map a publish failure reason to an operator-facing, actionable message. */
function friendlyApproveError(reason: string): string {
  switch (reason) {
    case 'no_token':
      return 'X is not connected. Reconnect it and check your account before creating a replacement post.';
    case 'partial_publish':
      return 'Posting did not complete. Some posts may have been sent. Check X before creating a replacement; this attempt will not be automatically resent.';
    case 'media_upload_failed':
      return 'The attachment could not be uploaded to X. The post was not sent.';
    case 'unsupported_channel':
      return 'This channel does not publish from the queue yet.';
    default:
      return `Publishing was not confirmed (${reason}). Check the destination before creating a replacement; this attempt will not be automatically resent.`;
  }
}

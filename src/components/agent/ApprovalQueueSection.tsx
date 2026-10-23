'use client';

/**
 * Phase 9.1 — Approval Queue section inside the AgentDrawer.
 *
 * Inserts between the posture pill row and the messages container. Mirrors
 * the posture row's chrome (dark backdrop + faint matrix-green bottom
 * border) so the visual register is continuous.
 *
 * When the queue is empty, renders a subtle `// queue clear //` footnote
 * (locked decision — see plan §9.1). When non-empty, renders one
 * `ApprovalQueueRow` per pending draft.
 */

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  useApprovalQueue,
  useApproveDraft,
  useEditDraft,
  useRejectDraft,
} from '@/lib/hooks/use-approval-queue';

export function ApprovalQueueSection() {
  const { data, isLoading, isFetching } = useApprovalQueue();
  const approve = useApproveDraft();
  const reject = useRejectDraft();
  const edit = useEditDraft();
  const drafts = data ?? [];
  const count = drafts.length;

  // Track which row IDs have an in-flight mutation so we can dim them.
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

  // Honest post-status: the approve flow used to silently remove the row even
  // on a dry-run or a failure, so "success" could mean nothing posted. We now
  // surface the real outcome (posted / dry-run / reconnect / failed).
  const [lastResult, setLastResult] = useState<ApproveOutcome | null>(null);

  function setPending(id: number, isPending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Auto-clear the status line so it doesn't linger.
  useEffect(() => {
    if (!lastResult) return;
    const t = setTimeout(() => setLastResult(null), 9000);
    return () => clearTimeout(t);
  }, [lastResult]);

  return (
    <section
      className="flex shrink-0 flex-col"
      style={{
        background: 'rgba(0, 0, 0, 0.32)',
        borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.08)',
      }}
      aria-label="Outbound approval queue"
    >
      {/* Header row — always visible */}
      <header
        className="flex items-center justify-between px-4 py-1.5"
        style={{
          borderBottom: count > 0 ? '1px solid rgba(var(--crt-glow-rgb), 0.06)' : 'none',
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            color: count > 0 ? 'var(--matrix-green, #00ff41)' : 'rgba(255, 255, 255, 0.32)',
          }}
        >
          Approval Queue · {count} pending
        </span>
        {(isLoading || isFetching) && (
          <Loader2
            size={11}
            className="animate-spin"
            style={{ color: 'rgba(var(--crt-glow-rgb), 0.4)' }}
            aria-label="Refreshing"
          />
        )}
      </header>

      {/* Honest post-status line */}
      {lastResult && (
        <output
          className="block px-4 py-1"
          style={{
            fontSize: 9.5,
            letterSpacing: '0.04em',
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.06)',
            color:
              lastResult.kind === 'posted'
                ? 'var(--severity-low, #00ff41)'
                : lastResult.kind === 'dryrun'
                  ? 'var(--severity-medium, #ffaa00)'
                  : 'var(--severity-high, #ff4444)',
          }}
          aria-live="polite"
        >
          {lastResult.message}
          {lastResult.reconnect && (
            <a
              href="/api/twitter/oauth/start"
              style={{ marginLeft: 6, color: 'inherit', textDecoration: 'underline' }}
            >
              Reconnect X →
            </a>
          )}
        </output>
      )}

      {/* Body — empty state or rows */}
      {count === 0 ? (
        <EmptyQueueFootnote loading={isLoading} />
      ) : (
        <ul
          className="flex flex-col px-3 py-1"
          style={{
            maxHeight: 280,
            overflowY: 'auto',
            listStyle: 'none',
            margin: 0,
            padding: '4px 12px',
          }}
        >
          {drafts.map((draft) => (
            <DeferredApprovalRow
              key={draft.id}
              draft={draft}
              isPending={pendingIds.has(draft.id)}
              onApprove={async (reviewedPayload) => {
                setPending(draft.id, true);
                try {
                  const res = await approve.mutateAsync({ id: draft.id, reviewedPayload });
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
      )}
    </section>
  );
}

// ─── Internals ───────────────────────────────────────────────────────────────

type ApproveOutcome = {
  kind: 'posted' | 'dryrun' | 'error';
  message: string;
  /** When true, show a "Reconnect X" link (token expired/revoked). */
  reconnect?: boolean;
};

/** Map a publish failure reason to an operator-facing, actionable message. */
function friendlyApproveError(reason: string): string {
  switch (reason) {
    case 'no_token':
      return 'X token expired — reconnect X, then approve again to post.';
    case 'partial_publish':
      return 'Partially posted — some tweets failed. Draft is back in the queue; retry.';
    case 'media_upload_failed':
      return "The attached image wasn't ready — draft is back in the queue; retry once it renders.";
    case 'unsupported_channel':
      return 'This channel does not publish from the queue yet.';
    default:
      return `Post failed (${reason}). Draft is back in the queue; retry.`;
  }
}

/**
 * Subtle "queue clear" footnote shown when no drafts are pending. CRT
 * terminal aesthetic — communicates `system is working, nothing pending`
 * without losing real estate or feeling alarming.
 */
function EmptyQueueFootnote({ loading }: { loading: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (loading) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [loading]);
  // The exact `last reviewed` timestamp is wired via a separate hook in a
  // follow-up; for v1 we just show the static clear marker. The `now`
  // tick keeps the component fresh in case we add the relative time later.
  void now;

  return (
    <output
      className="block px-4 py-1.5"
      style={{
        fontSize: 9,
        letterSpacing: '0.08em',
        fontFamily: "'Geist Mono', ui-monospace, monospace",
        color: 'rgba(255, 255, 255, 0.32)',
      }}
      aria-label="Approval queue is empty"
    >
      {'// queue clear //'}
    </output>
  );
}

import type { DraftRow } from '@/lib/outbound/drafts';
/**
 * Tiny indirection so the row component is loaded lazily on first non-empty
 * render. Keeps the empty-state footprint minimal for users who never see
 * a pending draft.
 */
import { ApprovalQueueRow } from './ApprovalQueueRow';

interface DeferredApprovalRowProps {
  draft: DraftRow;
  isPending: boolean;
  onApprove: (reviewedPayload: Record<string, unknown>) => void;
  onReject: (reason: string) => void;
  onEdit: (draftPayload: unknown) => Promise<void>;
}

function DeferredApprovalRow(props: DeferredApprovalRowProps) {
  return <ApprovalQueueRow {...props} />;
}

'use client';

/**
 * Phase 9.1 — Single row in the AgentDrawer Approval Queue.
 *
 * Compact single-line presentation:
 *
 *     ▌[CRIT] TWITTER  ████████░░  Daily brief — 5 stories   [✓] [✕]
 *      └ severity      └ channel    └ ai_relevance bar         └ approve / reject
 *
 * Pure presentational — all state lives in the parent ApprovalQueueSection.
 * Keyboard: Tab focuses the action buttons natively (no row-level shortcuts
 * in v1 — keeps the row semantically a non-interactive list-item).
 */

import { Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { DraftRow } from '@/lib/outbound/drafts';
import { DraftReview } from './DraftReview';

interface ApprovalQueueRowProps {
  draft: DraftRow;
  onApprove: (reviewedPayload: Record<string, unknown>) => void;
  onReject: (reason: string) => void;
  /** Save inline per-tweet edits. Resolves on success; rejects to keep the editor open. */
  onEdit?: (draftPayload: unknown) => Promise<void>;
  /** True while a mutation against this row is in flight. */
  isPending?: boolean;
  autoReview?: boolean;
}

export function ApprovalQueueRow({
  draft,
  onApprove,
  onReject,
  onEdit,
  isPending = false,
  autoReview = false,
}: ApprovalQueueRowProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const reasonInputId = useId();

  // ─── Inline editor state (twitter thread drafts + email reply drafts) ───
  const [editing, setEditing] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [basePayload, setBasePayload] = useState<Record<string, unknown> | null>(null);
  const [editTweets, setEditTweets] = useState<Array<{ id: number; text: string }>>([]);
  // Email reply drafts edit a subject + a single Markdown body, not tweets.
  const isEmail = draft.channel === 'email';
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const canEdit = Boolean(onEdit) && (draft.channel === 'twitter' || isEmail);

  async function openEditor() {
    setEditing(true);
    setSaveError(null);
    if (basePayload) return; // already loaded once
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/outbound/drafts/${draft.id}`, { credentials: 'include' });
      const json = (await res.json()) as { draft?: { draftPayload?: Record<string, unknown> } };
      if (isEmail) {
        const payload = json.draft?.draftPayload ?? { to: [], subject: '', bodyMarkdown: '' };
        setBasePayload(payload);
        setEditSubject(typeof payload.subject === 'string' ? payload.subject : '');
        setEditBody(typeof payload.bodyMarkdown === 'string' ? payload.bodyMarkdown : '');
      } else {
        const payload = json.draft?.draftPayload ?? { tweets: [], canonicalHashtag: '#AICyber' };
        const tweets = Array.isArray(payload.tweets)
          ? (payload.tweets as Array<{ text?: unknown }>)
          : [];
        setBasePayload(payload);
        setEditTweets(
          tweets.map((t, i) => ({ id: i, text: typeof t?.text === 'string' ? t.text : '' })),
        );
      }
    } catch {
      setSaveError('Could not load the draft for editing.');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function saveEdits() {
    if (!basePayload || !onEdit) return;
    setSaving(true);
    setSaveError(null);
    // Spread basePayload first so non-edited fields survive (the email reply's
    // inReplyToMessageId / references / gmailThreadId, or a thread's mediaId /
    // replyToTweetId / canonicalHashtag) — same payload-preservation contract.
    let payload: Record<string, unknown>;
    if (isEmail) {
      payload = { ...basePayload, subject: editSubject, bodyMarkdown: editBody };
    } else {
      const baseTweets = Array.isArray(basePayload.tweets)
        ? (basePayload.tweets as Array<Record<string, unknown>>)
        : [];
      payload = {
        ...basePayload,
        tweets: editTweets.map((tw, i) => ({ ...(baseTweets[i] ?? {}), text: tw.text })),
      };
    }
    try {
      await onEdit(payload);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Edit failed.');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (rejecting && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [rejecting]);

  function handleReasonKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setRejecting(false);
      setReason('');
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = reason.trim();
      if (trimmed.length > 0) {
        onReject(trimmed);
        setRejecting(false);
        setReason('');
      }
    }
  }

  const severityColor = severityToHex(draft.severity);
  const relevance = draft.aiRelevance ?? null;
  const headlineMaxLen = 48;
  const truncatedHeadline =
    draft.headline.length > headlineMaxLen
      ? `${draft.headline.slice(0, headlineMaxLen - 1)}…`
      : draft.headline;

  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 4px',
        borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.06)',
        opacity: isPending ? 0.45 : 1,
        transition: 'opacity 120ms',
        listStyle: 'none',
      }}
      aria-label={`Pending draft ${draft.id}: ${draft.headline}`}
      title={draft.previewText ?? draft.headline}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Severity stripe (3px left bar) */}
        <span
          aria-hidden
          style={{
            width: 3,
            alignSelf: 'stretch',
            background: severityColor,
            boxShadow: `0 0 4px ${severityColor}`,
            flexShrink: 0,
          }}
        />

        {/* Channel chip — matches IntelCard ChipRow register */}
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'var(--crt-glow, #00ff41)',
            border: '1px solid rgba(var(--crt-glow-rgb), 0.35)',
            padding: '1px 5px',
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          {draft.channel}
        </span>

        {/* AI-relevance bar (40px × 4px) */}
        <span
          role="progressbar"
          aria-label="AI relevance"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={relevance ?? undefined}
          aria-valuetext={
            relevance == null ? 'unscored' : `${(relevance * 100).toFixed(0)} percent`
          }
          style={{
            position: 'relative',
            width: 40,
            height: 4,
            background:
              relevance == null
                ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 4px)'
                : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            flexShrink: 0,
          }}
        >
          {relevance != null && (
            <span
              style={{
                position: 'absolute',
                inset: 0,
                width: `${Math.max(0, Math.min(1, relevance)) * 100}%`,
                background: severityColor,
                opacity: 0.85,
              }}
            />
          )}
        </span>

        {/* Headline */}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            color: 'var(--text-primary, #e8e8e8)',
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {truncatedHeadline}
        </span>

        {/* Action buttons */}
        {canEdit && (
          <ActionButton
            label={isEmail ? 'Edit reply' : 'Edit tweets'}
            onClick={() => (editing ? setEditing(false) : openEditor())}
            disabled={isPending || rejecting}
            color="var(--crt-glow, #00ff41)"
          >
            <Pencil size={12} aria-hidden />
          </ActionButton>
        )}
        <ActionButton
          label="Reject (R)"
          onClick={() => setRejecting(true)}
          disabled={isPending || rejecting || editing}
          color="var(--severity-high, #ff4444)"
        >
          <X size={12} aria-hidden />
        </ActionButton>
      </div>

      {!editing && !rejecting && (
        <DraftReview
          draft={draft}
          disabled={isPending}
          onApprove={onApprove}
          autoReview={autoReview}
        />
      )}

      {rejecting && (
        <div style={{ paddingLeft: 11 }}>
          <textarea
            id={reasonInputId}
            ref={textareaRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={handleReasonKey}
            placeholder="reason (mandatory) — esc to cancel, enter to send"
            rows={2}
            style={{
              width: '100%',
              fontSize: 10,
              padding: '4px 6px',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 68, 68, 0.4)',
              color: 'var(--text-primary, #e8e8e8)',
              fontFamily: "'Geist Mono', ui-monospace, monospace",
              resize: 'none',
              outline: 'none',
            }}
            aria-label="Rejection reason"
          />
        </div>
      )}

      {editing && (
        <div
          style={{
            paddingLeft: 11,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            paddingTop: 4,
          }}
        >
          {loadingDetail ? (
            <span
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.5)',
                fontFamily: "'Geist Mono', ui-monospace, monospace",
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Loader2 size={11} className="animate-spin" aria-hidden /> loading…
            </span>
          ) : (
            <>
              {isEmail ? (
                <>
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    aria-label="Reply subject"
                    placeholder="Subject"
                    style={{
                      width: '100%',
                      fontSize: 10,
                      padding: '4px 6px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(var(--crt-glow-rgb), 0.3)',
                      color: 'var(--text-primary, #e8e8e8)',
                      fontFamily: "'Geist Mono', ui-monospace, monospace",
                      outline: 'none',
                    }}
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={6}
                    aria-label="Reply body (Markdown)"
                    placeholder="Reply body (Markdown)"
                    style={{
                      width: '100%',
                      fontSize: 10,
                      padding: '4px 6px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(var(--crt-glow-rgb), 0.3)',
                      color: 'var(--text-primary, #e8e8e8)',
                      fontFamily: "'Geist Mono', ui-monospace, monospace",
                      resize: 'vertical',
                      outline: 'none',
                    }}
                  />
                </>
              ) : (
                editTweets.map((tw, i) => (
                  <textarea
                    key={`tw-${tw.id}`}
                    value={tw.text}
                    onChange={(e) =>
                      setEditTweets((prev) =>
                        prev.map((p) => (p.id === tw.id ? { ...p, text: e.target.value } : p)),
                      )
                    }
                    rows={2}
                    aria-label={`Tweet ${i + 1} of ${editTweets.length}`}
                    style={{
                      width: '100%',
                      fontSize: 10,
                      padding: '4px 6px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(var(--crt-glow-rgb), 0.3)',
                      color: 'var(--text-primary, #e8e8e8)',
                      fontFamily: "'Geist Mono', ui-monospace, monospace",
                      resize: 'vertical',
                      outline: 'none',
                    }}
                  />
                ))
              )}
              {saveError && (
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--severity-high, #ff4444)',
                    fontFamily: "'Geist Mono', ui-monospace, monospace",
                  }}
                >
                  {saveError}
                </span>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={saveEdits}
                  disabled={saving}
                  style={editButtonStyle('var(--severity-low, #00ff41)', saving)}
                >
                  {saving ? 'saving…' : 'save + keep pending'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setSaveError(null);
                  }}
                  disabled={saving}
                  style={editButtonStyle('rgba(255, 255, 255, 0.4)', saving)}
                >
                  cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function editButtonStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    padding: '3px 10px',
    background: 'transparent',
    border: `1px solid ${color}`,
    color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 2,
    opacity: disabled ? 0.5 : 1,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color: string;
  children: React.ReactNode;
}

function ActionButton({ label, onClick, disabled, color, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3px 5px',
        background: disabled ? 'transparent' : `${hexToRgba(color, 0.06)}`,
        border: `1px solid ${disabled ? 'rgba(255,255,255,0.06)' : hexToRgba(color, 0.35)}`,
        color: disabled ? 'var(--text-muted, #555)' : color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 2,
        transition: 'all 120ms',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/** Map draft severity → hex matching the Phase 9.0 tokens.css palette. */
function severityToHex(s: string | null): string {
  switch (s) {
    case 'critical':
      return '#ff0040';
    case 'high':
      return '#ff4444';
    case 'medium':
      return '#ffaa00';
    case 'low':
      return '#00ff41';
    case 'info':
      return '#666666';
    default:
      return '#7a8b99'; // neutral fallback
  }
}

/** Convert a hex string + alpha to an rgba() expression. */
function hexToRgba(hex: string, alpha: number): string {
  // Accept either CSS variable references or hex literals
  if (hex.startsWith('var(')) {
    // For CSS var with fallback, we can't do alpha; approximate via the fallback hex.
    const m = hex.match(/#([0-9a-f]{6})/i);
    if (!m) return hex;
    hex = `#${m[1]}`;
  }
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

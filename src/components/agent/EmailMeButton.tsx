/**
 * Phase 13 Tier 5 — EMAIL ME button for agent response message footers.
 *
 * Sibling to PostToXButton in `AgentDrawer.tsx`. Same gating
 * (isCriticalAlertMessage), same matrix-green-glass chrome, same
 * modal-confirm UX. Different outbound channel: POSTs the full agent
 * response to `/api/outbound/email-me` for inbox delivery rendered via
 * the AgentResponseEmail template.
 *
 * Why a separate component:
 *   - Each button owns its own optimistic state (idle → sending → sent → reset)
 *   - The confirm modal pre-renders a content preview and the recipient
 *     fingerprint so the operator can sanity-check before shipping
 *   - The Force re-send checkbox lets the operator override dedup for
 *     intentional iteration on the same message
 *
 * Pairing rule: this button is rendered IMMEDIATELY AFTER PostToXButton
 * in MessageBubble — same severity gate, adjacent in the footer row, so
 * the operator sees both outbound options together.
 */

'use client';

import { Loader2, Mail, X } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { sendEmailMe } from '@/lib/outbound/send-email-me';
import {
  type GeneratedImageAttachment,
  type GeneratedVideoAttachment,
  useAgentStore,
} from '@/lib/store/agent-store';

interface EmailMeButtonProps {
  messageContent: string;
  /** ms epoch timestamp from the ConversationMessage — used to derive the
   *  dedup entity_id on the server. Same value across re-renders of the
   *  same message, so re-clicks naturally hit the at-most-once gate. */
  messageTimestamp: number;
  /** Ready generated images on this message — operator can file-attach them. */
  generatedImages?: GeneratedImageAttachment[];
  /** Ready generated videos on this message — operator can file-attach them. */
  generatedVideos?: GeneratedVideoAttachment[];
}

/** Match severity tags like **[CRITICAL]** to extract for the email stripe. */
const SEVERITY_TAG_RE = /\*\*\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]\*\*/i;
const CVE_ID_RE = /\bCVE-\d{4}-\d{4,7}\b/;

function extractSeverity(content: string): string | null {
  const m = content.match(SEVERITY_TAG_RE);
  return m ? m[1]!.toLowerCase() : null;
}

function extractCveId(content: string): string | null {
  const m = content.match(CVE_ID_RE);
  return m ? m[0] : null;
}

/**
 * Mirror of distillTweetSeed from AgentDrawer.tsx. Duplicated here rather
 * than imported to keep this component standalone (the button can be moved
 * or re-used without dragging AgentDrawer's exports with it). If both copies
 * drift, the Twitter distillation panel in the email will look subtly
 * different from what POST TO X shows — flag for unification only if that
 * actually happens.
 */
function distillTweetSeed(content: string, max = 250): string {
  let s = content;
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/\*\*\[([^\]]+)\]\*\*/g, '[$1]');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^---+$/gm, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max - 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export const EmailMeButton = React.memo(function EmailMeButton({
  messageContent,
  messageTimestamp,
  generatedImages = [],
  generatedVideos = [],
}: EmailMeButtonProps) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [forceResend, setForceResend] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<
    | { kind: 'idle' }
    | { kind: 'sent'; alreadySent: boolean; recipient: string }
    | { kind: 'error'; detail: string }
  >({ kind: 'idle' });

  const cveId = useMemo(() => extractCveId(messageContent), [messageContent]);
  const severity = useMemo(() => extractSeverity(messageContent), [messageContent]);
  const distillation = useMemo(() => distillTweetSeed(messageContent, 250), [messageContent]);
  const previewSnippet = useMemo(() => {
    const flat = messageContent.replace(/\s+/g, ' ').trim();
    return flat.length > 280 ? `${flat.slice(0, 280)}…` : flat;
  }, [messageContent]);

  // Ready media the operator can file-attach. Email can carry both kinds, so
  // this is a multi-select (unlike the X picker's single media kind).
  const mediaOptions = useMemo(() => {
    const opts: Array<{ id: string; blobUrl: string; kind: 'image' | 'video'; label: string }> = [];
    for (const img of generatedImages) {
      if (img.blobUrl) {
        opts.push({
          id: `image:${img.generatedMediaId}`,
          blobUrl: img.blobUrl,
          kind: 'image',
          label: `Image · ${img.styleTag?.replace(/_/g, ' ') ?? img.generatedMediaId}`,
        });
      }
    }
    for (const vid of generatedVideos) {
      if (vid.blobUrl && vid.status === 'ready') {
        opts.push({
          id: `video:${vid.generatedMediaId}`,
          blobUrl: vid.blobUrl,
          kind: 'video',
          label: `Video · ${vid.styleTag?.replace(/_/g, ' ') ?? vid.generatedMediaId}`,
        });
      }
    }
    return opts;
  }, [generatedImages, generatedVideos]);

  const toggleMedia = useCallback((id: string) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpen = useCallback(() => {
    setResult({ kind: 'idle' });
    setForceResend(false);
    setSelectedMediaIds(new Set());
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    if (!sending) setOpen(false);
  }, [sending]);

  const handleSend = useCallback(async () => {
    setSending(true);
    try {
      const attachImageUrls = mediaOptions
        .filter((o) => o.kind === 'image' && selectedMediaIds.has(o.id))
        .map((o) => o.blobUrl);
      const attachVideoUrls = mediaOptions
        .filter((o) => o.kind === 'video' && selectedMediaIds.has(o.id))
        .map((o) => o.blobUrl);
      const json = await sendEmailMe({
        messageContent,
        messageTimestamp,
        severity,
        alertEntityKind: cveId ? 'cve' : 'agent_message',
        alertEntityId: cveId,
        twitterDistillation: distillation,
        forceResend,
        attachImageUrls,
        attachVideoUrls,
      });
      if (!json.ok) {
        setResult({
          kind: 'error',
          detail: json.detail ?? json.error ?? 'send failed',
        });
        return;
      }
      setResult({
        kind: 'sent',
        alreadySent: Boolean(json.alreadySent),
        recipient: json.recipient ?? '(recipient unknown)',
      });
      // Persist an "Emailed ✓" badge on the originating message (survives reload).
      useAgentStore
        .getState()
        .markMessageEmailed(messageTimestamp, Date.now(), json.recipient ?? undefined);
      // Auto-close the modal after a moment so the operator sees the success
      // state long enough to read the recipient address ("Sent to operator@example.org"
      // is the receipt — too-fast auto-close defeats it). 5s is the sweet spot:
      // long enough to read + confirm recipient, short enough to not feel sticky.
      setTimeout(() => setOpen(false), 5000);
    } catch (err) {
      setResult({
        kind: 'error',
        detail: err instanceof Error ? err.message : 'network_error',
      });
    } finally {
      setSending(false);
    }
  }, [
    messageContent,
    messageTimestamp,
    severity,
    cveId,
    distillation,
    forceResend,
    mediaOptions,
    selectedMediaIds,
  ]);

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
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(var(--crt-glow-rgb), 0.55)';
          e.currentTarget.style.background = 'rgba(var(--crt-glow-rgb), 0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(var(--crt-glow-rgb), 0.18)';
          e.currentTarget.style.background = 'rgba(var(--crt-glow-rgb), 0.06)';
        }}
        title="Email full SITREP + Twitter distillation to the operator inbox (manual)"
      >
        <Mail size={8} />
        Email
      </button>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close handled by Esc on dialog
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Email this SITREP"
            className="w-full max-w-md rounded-lg p-4"
            style={{
              background: 'var(--bg-primary, #0a0a0a)',
              border: '1px solid rgba(var(--crt-glow-rgb), 0.3)',
              boxShadow: '0 0 24px rgba(var(--crt-glow-rgb), 0.15)',
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div
                className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider"
                style={{ color: 'var(--matrix-green, #00ff41)' }}
              >
                <Mail size={12} />
                Email this SITREP
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded p-1 hover:bg-white/5"
                aria-label="Close"
                disabled={sending}
              >
                <X size={14} style={{ color: 'var(--text-dim, #888)' }} />
              </button>
            </div>

            <div
              className="mb-3 rounded p-2 text-[10px] font-mono leading-relaxed"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
                color: 'var(--text-primary, #e8e8e8)',
                maxHeight: '120px',
                overflowY: 'auto',
              }}
            >
              <div
                className="mb-1 uppercase tracking-wider text-[8px]"
                style={{ color: 'var(--text-dim, #888)' }}
              >
                preview ({messageContent.length} chars)
              </div>
              {previewSnippet}
            </div>

            <div
              className="mb-2 flex items-center gap-2 text-[10px] font-mono"
              style={{ color: 'var(--text-dim, #888)' }}
            >
              <span>severity: {severity ?? 'unset'}</span>
              <span>·</span>
              <span>{cveId ?? 'no CVE'}</span>
              <span>·</span>
              <span>incl. twitter distillation</span>
            </div>

            {mediaOptions.length > 0 && (
              <div className="mb-3">
                <div
                  className="mb-1 text-[8px] font-mono uppercase tracking-wider"
                  style={{ color: 'var(--text-dim, #888)' }}
                >
                  Attach media (files)
                </div>
                <div className="space-y-1">
                  {mediaOptions.map((opt) => (
                    <label
                      key={opt.id}
                      className="flex cursor-pointer items-center gap-2 text-[10px] font-mono"
                      style={{ color: 'var(--text-secondary, #a8a8a8)' }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedMediaIds.has(opt.id)}
                        onChange={() => toggleMedia(opt.id)}
                        disabled={sending}
                        className="cursor-pointer"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label
              className="mb-3 flex items-center gap-2 text-[10px] font-mono cursor-pointer"
              style={{ color: 'var(--text-secondary, #a8a8a8)' }}
            >
              <input
                type="checkbox"
                checked={forceResend}
                onChange={(e) => setForceResend(e.target.checked)}
                disabled={sending}
                className="cursor-pointer"
              />
              <span>Force re-send (bypass dedup)</span>
            </label>

            {result.kind === 'error' && (
              <div
                className="mb-3 rounded px-2 py-1 text-[10px] font-mono"
                style={{
                  background: 'rgba(255, 68, 68, 0.1)',
                  color: 'var(--color-negative, #ff4444)',
                  border: '1px solid rgba(255, 68, 68, 0.25)',
                }}
                role="alert"
              >
                {result.detail}
              </div>
            )}

            {result.kind === 'sent' && (
              <div
                className="mb-3 rounded px-2 py-1 text-[10px] font-mono"
                style={{
                  background: 'rgba(var(--crt-glow-rgb), 0.1)',
                  color: 'var(--matrix-green, #00ff41)',
                  border: '1px solid rgba(var(--crt-glow-rgb), 0.25)',
                }}
                role="status"
              >
                {result.alreadySent
                  ? `Already sent to ${result.recipient} earlier`
                  : `Sent to ${result.recipient}`}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={sending}
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
                onClick={handleSend}
                disabled={sending || result.kind === 'sent'}
                className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider disabled:opacity-40"
                style={{
                  color: 'var(--bg-primary, #0a0a0a)',
                  background: 'var(--matrix-green, #00ff41)',
                  border: '1px solid var(--matrix-green, #00ff41)',
                }}
              >
                {sending ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />}
                {sending ? 'Sending…' : result.kind === 'sent' ? 'Sent' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

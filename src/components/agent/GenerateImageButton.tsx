/**
 * IMG button on agent response cards (Phase 14 Tier A).
 *
 * Mirrors GenerateVideoButton's fire-and-forget (NON-blocking) pattern:
 *   - Click button → modal opens with the detected brief + a style picker.
 *   - Submit → POST /api/outbound/generate-image (returns 202 + a pending id).
 *   - On the START response we seed a PENDING GeneratedImageAttachment onto the
 *     message (via onImageReady) and CLOSE the modal immediately. The AgentDrawer
 *     auto-poller owns the 10-30s wait and swaps the PNG in inline — so Max stays
 *     fully interactive while the infographic renders (it no longer holds the
 *     modal open with a polling loop).
 */

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { ImageIcon, X } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import type { GeneratedImageAttachment } from '@/lib/store/agent-store';
import { STYLE_REGISTRY, STYLE_TAGS, type StyleTag } from '@/lib/visual/style-registry';
import {
  buildVisualBriefSync,
  resolveVisualStyleTag,
  type VisualBriefSourceContext,
} from '@/lib/visual/visual-brief';

const STYLE_OPTIONS = [
  { value: 'auto', label: 'Auto (recommended)' },
  ...STYLE_TAGS.map((tag) => ({ value: tag, label: STYLE_REGISTRY[tag].label })),
] as const;

const SNIPPET_MAX = 280;

interface GenerateImageButtonProps {
  messageContent: string;
  messageTimestamp: number;
  entityKind?: string;
  entityId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  sourceContext?: VisualBriefSourceContext;
  onImageReady?: (image: GeneratedImageAttachment) => void;
  disabled?: boolean;
}

type Status = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'failed'; error: string };

type ImageApiPayload = {
  ok?: boolean;
  generatedMediaId?: string | number;
  status?: string;
  blobUrl?: string | null;
  error?: string;
  detail?: string;
  errorMessage?: string | null;
  styleTag?: string;
  pollUrl?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJsonPayload(res: Response): Promise<ImageApiPayload | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? (parsed as ImageApiPayload) : null;
  } catch {
    return {
      ok: false,
      error: 'invalid_json_response',
      detail: `HTTP ${res.status} returned a non-JSON response.`,
    };
  }
}

function errorFromResponse(
  res: Response,
  payload: ImageApiPayload | null,
  fallback: string,
): string {
  const error = typeof payload?.error === 'string' ? payload.error : null;
  if (error === 'capability_disabled:media')
    return 'Image creation is disabled for this installation. Enable media generation and configure an image provider in the server settings.';
  const detail = typeof payload?.detail === 'string' ? payload.detail : null;
  const message = error && detail ? `${error}: ${detail}` : (detail ?? error);
  if (message) return message;
  if (!res.ok) return `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  return fallback;
}

function normalizeGeneratedMediaId(value: string | number | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function resolvePollUrl(payload: ImageApiPayload | null, generatedMediaId: string): string {
  return typeof payload?.pollUrl === 'string' &&
    payload.pollUrl.startsWith('/api/outbound/generated-media/')
    ? payload.pollUrl
    : `/api/outbound/generated-media/${generatedMediaId}`;
}

function seedStatus(value: string | undefined): 'pending' | 'ready' | 'failed' {
  return value === 'ready' || value === 'failed' ? value : 'pending';
}

export function GenerateImageButton({
  messageContent,
  messageTimestamp,
  entityKind,
  entityId,
  severity,
  sourceContext,
  onImageReady,
  disabled = false,
}: GenerateImageButtonProps) {
  const [open, setOpen] = useState(false);
  const stylePickerId = useId();
  const [styleChoice, setStyleChoice] = useState<string>('auto');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const busy = status.kind === 'submitting';

  const snippet =
    messageContent.length <= SNIPPET_MAX
      ? messageContent
      : `${messageContent.slice(0, SNIPPET_MAX - 1)}…`;
  const visualBrief = useMemo(
    () =>
      buildVisualBriefSync({
        messageContent,
        sourceContext,
        entityKind,
        entityId,
        severity,
        bluf: snippet,
      }),
    [entityId, entityKind, messageContent, severity, snippet, sourceContext],
  );
  const resolvedPreviewStyle = resolveVisualStyleTag(
    visualBrief,
    styleChoice === 'auto' ? undefined : (styleChoice as StyleTag),
  );

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setStyleChoice('auto');
    setStatus({ kind: 'idle' });
  }, [busy]);

  const submit = useCallback(async () => {
    setStatus({ kind: 'submitting' });
    try {
      const styleTag = styleChoice === 'auto' ? undefined : styleChoice;
      const res = await fetch('/api/outbound/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageContent,
          messageTimestamp,
          styleTag,
          entityKind,
          entityId,
          severity,
          sourceContext,
          bluf: snippet,
        }),
      });
      const data = await readJsonPayload(res);
      const generatedMediaId = normalizeGeneratedMediaId(data?.generatedMediaId);
      if (!res.ok || !data?.ok || !generatedMediaId) {
        setStatus({ kind: 'failed', error: errorFromResponse(res, data, 'submit failed') });
        return;
      }
      // Fire-and-forget: seed a pending attachment on the message + close. The
      // AgentDrawer auto-poller renders the PNG inline when it's ready (≈10-30s).
      // A dedup hit can come back already-ready (status:'ready' + blobUrl) — that
      // seeds a non-pending attachment the poller simply skips.
      onImageReady?.({
        generatedMediaId,
        status: seedStatus(data.status),
        blobUrl: data.blobUrl ?? undefined,
        styleTag: data.styleTag ?? styleTag,
        pollUrl: resolvePollUrl(data, generatedMediaId),
        createdAt: Date.now(),
      });
      setOpen(false);
      setStyleChoice('auto');
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'failed', error: String(err) });
    }
  }, [
    entityId,
    entityKind,
    messageContent,
    messageTimestamp,
    onImageReady,
    severity,
    sourceContext,
    styleChoice,
    snippet,
  ]);

  return (
    <Dialog.Root open={open} onOpenChange={(value) => (value ? setOpen(true) : close())}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="inline-flex min-h-7 items-center gap-1.5 rounded px-2 py-1 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
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
          aria-label="Generate image from this response"
          title="Generate an image from this response"
        >
          <ImageIcon size={12} aria-hidden />
          Create image
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-black/70"
          style={{ zIndex: 'calc(var(--z-agent-drawer) + 25)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-[var(--crt-glow)]/30 bg-[var(--bg-primary)] p-6 font-mono shadow-2xl"
          style={{ zIndex: 'calc(var(--z-agent-drawer) + 26)' }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="text-[var(--crt-glow)] text-lg uppercase tracking-wider">
              Create image
            </Dialog.Title>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded p-1 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Close image generator"
              title={busy ? 'Starting generation…' : 'Close'}
            >
              <X size={14} style={{ color: 'var(--text-dim, #888)' }} />
            </button>
          </div>

          <Dialog.Description className="mb-4 text-xs text-[var(--text-dim)]">
            Create a private image from this response. Review it before attaching or publishing.
          </Dialog.Description>
          <div className="mb-4">
            <div className="text-[var(--text-primary)] text-xs uppercase opacity-60 mb-1">
              Detected brief
            </div>
            <div className="border-l-2 border-[var(--brand-accent)] pl-3">
              <div className="text-sm font-bold text-[var(--text-primary)]">
                {visualBrief.title}
              </div>
              <div className="mt-1 text-xs text-[var(--text-secondary)] max-h-20 overflow-auto">
                {visualBrief.bluf}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] uppercase tracking-wider">
                <span className="border border-[rgba(var(--crt-glow-rgb),0.22)] px-1.5 py-0.5 text-[var(--crt-glow)]">
                  {visualBrief.severity}
                </span>
                <span className="border border-[rgba(var(--crt-glow-rgb),0.14)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  {visualBrief.metrics.length} metrics
                </span>
                <span className="border border-[rgba(var(--crt-glow-rgb),0.14)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  {visualBrief.sections.length} sections
                </span>
                <span className="border border-[rgba(var(--crt-glow-rgb),0.14)] px-1.5 py-0.5 text-[var(--text-muted)]">
                  {visualBrief.sources.length} sources
                </span>
                <span className="border border-[rgba(var(--brand-accent-rgb),0.45)] px-1.5 py-0.5 text-[var(--brand-accent)]">
                  {resolvedPreviewStyle.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label
              htmlFor={stylePickerId}
              className="text-[var(--text-primary)] text-xs uppercase opacity-60 mb-1 block"
            >
              Style
            </label>
            <select
              id={stylePickerId}
              value={styleChoice}
              onChange={(e) => setStyleChoice(e.target.value)}
              disabled={busy}
              className="w-full bg-black border border-[var(--crt-glow)] text-[var(--text-primary)] px-2 py-1 text-sm"
            >
              {STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <p className="mb-3 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            Renders in ~10-30s · attaches to this response · Max stays free while it runs
          </p>

          {status.kind === 'failed' && (
            <div className="mb-2 text-xs text-[var(--severity-critical)]">✗ {status.error}</div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="px-3 py-1 text-xs uppercase tracking-wider border border-gray-600 text-gray-400 hover:bg-gray-800 disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="px-3 py-1 text-xs uppercase tracking-wider border border-[var(--crt-glow)] text-[var(--crt-glow)] hover:bg-[var(--crt-glow)] hover:text-black disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Generate'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

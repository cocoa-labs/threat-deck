/**
 * VID button on agent response cards.
 *
 * Sibling of GenerateImageButton, but tuned for Seedance video:
 *   - Click → compact popover (not a full modal) with Format / Length / Quality
 *     / Genre pre-filled to vertical defaults; Generate is the confirm step.
 *   - Fire-and-forget: on submit we seed a pending GeneratedVideoAttachment on
 *     the message (via onVideoReady) and close the popover. The AgentDrawer
 *     auto-poller owns progress and swaps in the playable MP4 — the button does
 *     NOT hold a 1-3 min polling loop (this is the deliberate divergence from
 *     the IMG button, whose renders finish in 10-30s).
 *
 * Option values are the exact seedance_2_0 enums (`higgsfield model get`):
 *   aspect_ratio ∈ {9:16,16:9,1:1}, genre ∈ {noir,epic,drama,action,auto},
 *   resolution ∈ {480p,720p,1080p,4k}, duration = any integer 4-15.
 */

'use client';

import { Film, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { GeneratedVideoAttachment } from '@/lib/store/agent-store';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';

const FORMAT_OPTIONS = [
  { value: '9:16', label: 'Vertical · 9:16' },
  { value: '16:9', label: 'Horizontal · 16:9' },
  { value: '1:1', label: 'Square · 1:1' },
] as const;

// seedance_2_0 accepts any integer 4-15 (verified against the live API: 3s and
// 16s are both rejected by name). We offer 5 as the floor deliberately rather
// than the server's 4 — MIN_DURATION_SECONDS in video-params.ts matches.
const LENGTH_OPTIONS = [
  { value: '5', label: '5 sec' },
  { value: '8', label: '8 sec' },
  { value: '12', label: '12 sec' },
  { value: '15', label: '15 sec' },
] as const;

// Resolution drives cost far more than length does. Rates are credits/sec,
// measured against the live API: 720p/fast 3.5, 1080p 9.0, 4k 22.0 — so the
// multipliers below are relative to our 720p default, not decoration.
// Picking 1080p or 4k also forces mode `std` (the API rejects fast above 720p);
// normalizeVideoParams does that promotion server-side, so this control sends
// resolution alone and there is no second knob to keep in sync.
const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p · standard' },
  { value: '1080p', label: '1080p · 2.6× credits' },
  { value: '4k', label: '4K · 6.3× credits' },
] as const;

const GENRE_OPTIONS = [
  { value: 'noir', label: 'Noir' },
  { value: 'epic', label: 'Epic' },
  { value: 'drama', label: 'Drama' },
  { value: 'action', label: 'Action' },
  { value: 'auto', label: 'Auto' },
] as const;

interface GenerateVideoButtonProps {
  messageContent: string;
  messageTimestamp: number;
  entityKind?: string;
  entityId?: string;
  sourceContext?: VisualBriefSourceContext;
  onVideoReady?: (video: GeneratedVideoAttachment) => void;
}

type Status = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'failed'; error: string };

/**
 * Preflight state. Checked when the popover OPENS, so a signed-out CLI or a
 * down render worker is visible before the operator picks the render knobs —
 * previously the only signal was a red line after a full round-trip.
 */
type Health =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'blocked'; state: string; detail: string };

type HealthPayload = {
  ok?: boolean;
  ready?: boolean;
  state?: string;
  detail?: string | null;
  error?: string;
};

const HEALTH_LABELS: Record<string, string> = {
  unauthed: 'Higgsfield signed out',
  missing_cli: 'Higgsfield CLI missing',
  no_workspace: 'No Higgsfield workspace',
  disabled: 'Video generation disabled',
  unreachable: 'Render worker unreachable',
  secret_rejected: 'Render worker misconfigured',
  error: 'Video generation unavailable',
};

type VideoApiPayload = {
  ok?: boolean;
  generatedMediaId?: string | number;
  status?: string;
  blobUrl?: string | null;
  error?: string;
  detail?: string;
  styleTag?: string;
  pollUrl?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJsonPayload(res: Response): Promise<VideoApiPayload | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? (parsed as VideoApiPayload) : null;
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
  payload: VideoApiPayload | null,
  fallback: string,
): string {
  const error = typeof payload?.error === 'string' ? payload.error : null;
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

function resolvePollUrl(payload: VideoApiPayload | null, generatedMediaId: string): string {
  return typeof payload?.pollUrl === 'string' &&
    payload.pollUrl.startsWith('/api/outbound/generated-media/')
    ? payload.pollUrl
    : `/api/outbound/generated-media/${generatedMediaId}`;
}

function seedStatus(value: string | undefined): 'pending' | 'ready' | 'failed' {
  return value === 'ready' || value === 'failed' ? value : 'pending';
}

export function GenerateVideoButton({
  messageContent,
  messageTimestamp,
  entityKind,
  entityId,
  sourceContext,
  onVideoReady,
}: GenerateVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<string>('9:16');
  const [length, setLength] = useState<string>('8');
  const [genre, setGenre] = useState<string>('noir');
  const [resolution, setResolution] = useState<string>('720p');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [health, setHealth] = useState<Health>({ kind: 'checking' });

  const busy = status.kind === 'submitting';
  const blocked = health.kind === 'blocked';

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setStatus({ kind: 'idle' });
  }, [busy]);

  const checkHealth = useCallback(async () => {
    setHealth({ kind: 'checking' });
    try {
      const res = await fetch('/api/outbound/generate-video/health', { credentials: 'include' });
      const data = (await res.json().catch(() => ({}))) as HealthPayload;
      if (data.error === 'unauthorized') {
        setHealth({ kind: 'blocked', state: 'error', detail: 'Sign in required.' });
        return;
      }
      if (!res.ok || !data.ok) {
        setHealth({
          kind: 'blocked',
          state: 'error',
          detail: data.detail ?? `Health check failed (HTTP ${res.status}).`,
        });
        return;
      }
      if (data.ready) {
        setHealth({ kind: 'ready' });
        return;
      }
      setHealth({
        kind: 'blocked',
        state: typeof data.state === 'string' ? data.state : 'error',
        detail: data.detail ?? 'Video generation is unavailable.',
      });
    } catch (err) {
      // A failed CHECK is not proof the capability is down — don't block the
      // operator on our own network blip.
      console.warn('[GenerateVideoButton] health check failed:', err);
      setHealth({ kind: 'ready' });
    }
  }, []);

  // Side effects stay OUT of the setState updater — React double-invokes
  // updaters in StrictMode, which would fire two health probes (two CLI spawns)
  // per open.
  const handleOpen = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next) {
      setStatus({ kind: 'idle' });
      void checkHealth();
    }
  }, [open, checkHealth]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const submit = useCallback(async () => {
    setStatus({ kind: 'submitting' });
    try {
      const res = await fetch('/api/outbound/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageContent,
          messageTimestamp,
          aspectRatio: format,
          durationSeconds: Number(length),
          resolution,
          genre,
          entityKind,
          entityId,
          sourceContext,
        }),
      });
      const data = await readJsonPayload(res);
      const generatedMediaId = normalizeGeneratedMediaId(data?.generatedMediaId);
      if (!res.ok || !data?.ok || !generatedMediaId) {
        const error = errorFromResponse(res, data, 'submit failed');
        setStatus({ kind: 'failed', error });
        // Also land the failure in the thread. Popover-only errors died the
        // moment the popover closed, which is what made this look like a
        // dead end rather than a fixable capability problem.
        onVideoReady?.({
          generatedMediaId: generatedMediaId ?? `failed-${messageTimestamp}-${Date.now()}`,
          status: 'failed',
          errorMessage: error,
          createdAt: Date.now(),
        });
        return;
      }
      onVideoReady?.({
        generatedMediaId,
        status: seedStatus(data.status),
        blobUrl: data.blobUrl ?? undefined,
        styleTag: data.styleTag,
        pollUrl: resolvePollUrl(data, generatedMediaId),
        createdAt: Date.now(),
      });
      // Fire-and-forget: the inline card now shows progress, so dismiss.
      setOpen(false);
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'failed', error: String(err) });
    }
  }, [
    messageContent,
    messageTimestamp,
    format,
    length,
    resolution,
    genre,
    entityKind,
    entityId,
    sourceContext,
    onVideoReady,
  ]);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-colors"
        style={{
          color: blocked ? 'var(--severity-medium, #ffaa00)' : 'var(--matrix-green, #00ff41)',
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
        aria-label="Generate video from this response"
        title="Generate a video from this response"
      >
        <Film size={8} />
        VID
      </button>

      {open && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: click-away backdrop; Esc closes the popover */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc handled via document listener */}
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            className="absolute bottom-full right-0 z-50 mb-1 w-60 border border-[var(--crt-glow)] bg-[var(--bg-primary)] p-3 font-mono shadow-lg shadow-black/50"
            role="dialog"
            aria-label="Generate video"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--crt-glow)]">
                Generate video
              </span>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded p-0.5 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Close video generator"
              >
                <X size={11} style={{ color: 'var(--text-dim, #888)' }} />
              </button>
            </div>

            {health.kind === 'checking' && (
              <div className="py-2 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                Checking Higgsfield…
              </div>
            )}

            {health.kind === 'blocked' && (
              <div className="space-y-2">
                <div
                  className="text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--severity-medium, #ffaa00)' }}
                >
                  {HEALTH_LABELS[health.state] ?? HEALTH_LABELS.error}
                </div>
                <p className="text-[9px] leading-relaxed text-[var(--text-primary)]">
                  {health.detail}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void checkHealth()}
                    className="border border-[var(--crt-glow)] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[var(--crt-glow)] hover:bg-[var(--crt-glow)] hover:text-black"
                  >
                    Re-check
                  </button>
                </div>
              </div>
            )}

            <div className={health.kind === 'ready' ? 'space-y-2' : 'hidden'}>
              <label className="block">
                <span className="mb-0.5 block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
                  Format
                </span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  disabled={busy}
                  className="w-full border border-[var(--crt-glow)] bg-black px-1.5 py-0.5 text-[10px] text-[var(--text-primary)]"
                >
                  {FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
                  Length
                </span>
                <select
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  disabled={busy}
                  className="w-full border border-[var(--crt-glow)] bg-black px-1.5 py-0.5 text-[10px] text-[var(--text-primary)]"
                >
                  {LENGTH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
                  Quality
                </span>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={busy}
                  className="w-full border border-[var(--crt-glow)] bg-black px-1.5 py-0.5 text-[10px] text-[var(--text-primary)]"
                >
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
                  Genre
                </span>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  disabled={busy}
                  className="w-full border border-[var(--crt-glow)] bg-black px-1.5 py-0.5 text-[10px] text-[var(--text-primary)]"
                >
                  {GENRE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {health.kind === 'ready' && (
              <p className="mt-2 text-[8px] uppercase tracking-wide text-[var(--text-muted)]">
                Renders in ~1-3 min · uses paid credits
              </p>
            )}

            {status.kind === 'failed' && (
              <div className="mt-2 text-[9px] text-[var(--severity-critical)]">
                ✗ {status.error}
              </div>
            )}

            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="border border-gray-600 px-2 py-0.5 text-[9px] uppercase tracking-wider text-gray-400 hover:bg-gray-800 disabled:opacity-30"
              >
                {health.kind === 'ready' ? 'Cancel' : 'Close'}
              </button>
              {health.kind === 'ready' && (
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="border border-[var(--crt-glow)] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[var(--crt-glow)] hover:bg-[var(--crt-glow)] hover:text-black disabled:opacity-50"
                >
                  {busy ? 'Starting…' : 'Generate'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

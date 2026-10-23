/**
 * Remote Seedance video provider — production transport.
 *
 * The local CLI provider (`higgsfield-cli-video.ts`) shells out to the
 * `higgsfield` binary, which can't run on Vercel serverless. In production the
 * binary lives on the always-on Fly machine (it runs the full Next app). This
 * provider speaks the same interface as the CLI provider but forwards
 * startVideo/getJob over HTTP to the Fly machine's internal executor routes
 * (`/api/internal/video/*`), guarded by a shared secret.
 *
 * Vercel orchestrates (DB, dedup, Blob); Fly only executes the CLI. Both report
 * the same providerId/modelVersion so DB rows and `refreshGeneratedVideoIfNeeded`
 * don't need to know which transport ran.
 */

import {
  HIGGSFIELD_SEEDANCE_MODEL,
  HIGGSFIELD_VIDEO_PROVIDER,
  HiggsfieldCliError,
  type HiggsfieldErrorCode,
  type HiggsfieldJobState,
  type HiggsfieldStartVideoInput,
  probeDetail,
  probeStateFromError,
  type VideoProviderProbe,
} from '@/lib/visual/providers/higgsfield-cli-video';

const DEFAULT_TIMEOUT_MS = 30_000;

export class HiggsfieldRemoteVideoProvider {
  readonly providerId = HIGGSFIELD_VIDEO_PROVIDER;
  readonly modelVersion = HIGGSFIELD_SEEDANCE_MODEL;
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(
    baseUrl = process.env.HIGGSFIELD_REMOTE_URL,
    secret = process.env.INTERNAL_RENDER_SECRET,
  ) {
    if (!baseUrl?.trim()) {
      throw new HiggsfieldCliError(
        'HIGGSFIELD_REMOTE_URL is not configured for the remote video provider.',
        'disabled',
        undefined,
        'remote_worker',
      );
    }
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    this.secret = secret?.trim() ?? '';
  }

  async startVideo(input: HiggsfieldStartVideoInput): Promise<HiggsfieldJobState> {
    return this.request('POST', '/api/internal/video/start', input);
  }

  async getJob(jobId: string): Promise<HiggsfieldJobState> {
    return this.request('GET', `/api/internal/video/job/${encodeURIComponent(jobId)}`);
  }

  /**
   * Preflight for the VID popover. Hits the worker's own probe endpoint so the
   * answer reflects the machine that will actually run the CLI, not Vercel.
   */
  async probe(): Promise<VideoProviderProbe> {
    try {
      const res = await this.fetchWorker('GET', '/api/internal/video/health');
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        return {
          transport: 'remote_worker',
          state: 'secret_rejected',
          detail: remoteRemediation('worker_secret_rejected'),
        };
      }
      const parsed = safeJson(text) as { state?: unknown } | null;
      const state = typeof parsed?.state === 'string' ? parsed.state : null;
      if (!res.ok || !state) {
        return {
          transport: 'remote_worker',
          state: 'error',
          detail: `Render worker health check returned HTTP ${res.status}.`,
        };
      }
      return {
        transport: 'remote_worker',
        state: state as VideoProviderProbe['state'],
        ...(state === 'ready' ? {} : { detail: remoteRemediation(codeForProbeState(state)) }),
      };
    } catch (err) {
      if (err instanceof HiggsfieldCliError) {
        return {
          transport: 'remote_worker',
          state: probeStateFromError(err),
          detail: probeDetail(err),
        };
      }
      return {
        transport: 'remote_worker',
        state: 'unreachable',
        detail: remoteRemediation('worker_unreachable'),
      };
    }
  }

  private async fetchWorker(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-internal-render-secret': this.secret,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new HiggsfieldCliError(
        'Remote render worker is unreachable.',
        'worker_unreachable',
        err instanceof Error ? err.message : String(err),
        'remote_worker',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<HiggsfieldJobState> {
    const res = await this.fetchWorker(method, path, body);

    const text = await res.text();
    // A rejected shared secret is a DEPLOY misconfiguration, not a Higgsfield
    // credential problem — conflating the two sent operators to re-authenticate
    // the CLI for a mismatched INTERNAL_RENDER_SECRET.
    if (res.status === 401 || res.status === 403) {
      throw new HiggsfieldCliError(
        'Remote render worker rejected the internal secret.',
        'worker_secret_rejected',
        text.slice(0, 300),
        'remote_worker',
      );
    }
    if (res.status === 503) {
      throw new HiggsfieldCliError(
        'Remote render worker has video generation disabled.',
        'disabled',
        text.slice(0, 300),
        'remote_worker',
      );
    }
    if (!res.ok) {
      // The worker forwards the CLI's own error code; preserve it so an expired
      // credential on Fly reads as auth_required rather than a generic failure.
      const forwarded = forwardedCode(safeJson(text));
      throw new HiggsfieldCliError(
        'Remote render worker returned an error.',
        forwarded ?? 'cli_failed',
        `HTTP ${res.status}: ${text.slice(0, 300)}`,
        'remote_worker',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HiggsfieldCliError(
        'Remote render worker returned non-JSON output.',
        'parse_failed',
        text.slice(0, 300),
        'remote_worker',
      );
    }
    return toJobState(parsed);
  }
}

const FORWARDABLE_CODES = new Set<HiggsfieldErrorCode>([
  'auth_required',
  'missing_cli',
  'timed_out',
  'cli_failed',
  'parse_failed',
  'disabled',
]);

function forwardedCode(parsed: unknown): HiggsfieldErrorCode | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const code = (parsed as { error?: unknown }).error;
  return typeof code === 'string' && FORWARDABLE_CODES.has(code as HiggsfieldErrorCode)
    ? (code as HiggsfieldErrorCode)
    : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function remoteRemediation(code: HiggsfieldErrorCode): string {
  return new HiggsfieldCliError('', code, undefined, 'remote_worker').remediation;
}

function codeForProbeState(state: string): HiggsfieldErrorCode {
  switch (state) {
    case 'unauthed':
      return 'auth_required';
    case 'missing_cli':
      return 'missing_cli';
    case 'disabled':
      return 'disabled';
    case 'secret_rejected':
      return 'worker_secret_rejected';
    case 'unreachable':
      return 'worker_unreachable';
    default:
      return 'cli_failed';
  }
}

function toJobState(parsed: unknown): HiggsfieldJobState {
  if (!parsed || typeof parsed !== 'object') {
    throw new HiggsfieldCliError(
      'Remote render worker returned an unexpected payload.',
      'parse_failed',
      JSON.stringify(parsed).slice(0, 300),
    );
  }
  const rec = parsed as Record<string, unknown>;
  const jobId = typeof rec.jobId === 'string' && rec.jobId.trim() ? rec.jobId : null;
  if (!jobId) {
    throw new HiggsfieldCliError(
      'Remote render worker response did not include a job id.',
      'parse_failed',
      JSON.stringify(parsed).slice(0, 300),
    );
  }
  const status = typeof rec.status === 'string' ? rec.status : 'pending';
  const rawStatus = typeof rec.rawStatus === 'string' ? rec.rawStatus : status;
  const resultUrl = typeof rec.resultUrl === 'string' ? rec.resultUrl : null;
  return { jobId, status, rawStatus, resultUrl, raw: rec.raw ?? parsed };
}

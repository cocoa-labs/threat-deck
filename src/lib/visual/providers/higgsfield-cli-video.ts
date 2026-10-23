import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const HIGGSFIELD_VIDEO_PROVIDER = 'higgsfield_cli';
export const HIGGSFIELD_SEEDANCE_MODEL = 'seedance_2_0';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HiggsfieldStartVideoInput {
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  mode?: string;
  genre?: string;
}

export interface HiggsfieldJobState {
  jobId: string;
  status: string;
  rawStatus: string;
  resultUrl: string | null;
  raw: unknown;
}

/**
 * Which side actually ran the CLI. The remediation for an identical failure is
 * completely different per transport: locally the operator re-runs
 * `higgsfield auth login` on the machine hosting the dev server; in production
 * the CLI lives on the Fly worker and its credentials come from the
 * HIGGSFIELD_CREDENTIALS_JSON secret, so a local login changes nothing.
 */
export type HiggsfieldTransport = 'local_cli' | 'remote_worker';

export type HiggsfieldErrorCode =
  | 'disabled'
  | 'missing_cli'
  | 'auth_required'
  | 'workspace_required'
  | 'timed_out'
  | 'cli_failed'
  | 'parse_failed'
  | 'worker_unreachable'
  | 'worker_secret_rejected';

export class HiggsfieldCliError extends Error {
  constructor(
    message: string,
    public readonly code: HiggsfieldErrorCode,
    public readonly detail?: string,
    public readonly transport: HiggsfieldTransport = 'local_cli',
  ) {
    super(message);
    this.name = 'HiggsfieldCliError';
  }

  /** Operator-facing remediation. Surfaced verbatim in the VID popover AND by
   *  Max (tools.ts tells the model to relay it), so it must be true for the
   *  transport that actually failed. */
  get remediation(): string {
    return remediationFor(this.code, this.transport);
  }
}

/** True on a hosted serverless runtime, where there is no shell to run a CLI in
 *  and no .env.local to edit. */
function isServerlessDeployment(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

export function remediationFor(code: HiggsfieldErrorCode, transport: HiggsfieldTransport): string {
  const local = transport === 'local_cli';
  switch (code) {
    case 'disabled':
      if (!local) {
        return 'The render worker has video generation switched off. Set HIGGSFIELD_VIDEO_ENABLED=true on the Fly machine.';
      }
      // Serverless has no CLI to enable. If we're deployed and no render worker
      // is configured, video is not a capability of this deployment at all —
      // telling the operator to edit .env.local would be nonsense.
      return isServerlessDeployment()
        ? 'Video rendering is not available on this deployment. It needs the Seedance render worker (see docs/DEPLOY.md → Video render worker); until then, generate videos from a local dev session.'
        : 'Seedance video is switched off. Set HIGGSFIELD_VIDEO_ENABLED=true in .env.local and restart the dev server.';
    case 'missing_cli':
      return local
        ? 'The higgsfield CLI is not installed or not on PATH. Run `npm install -g @higgsfield/cli@latest`, then set HIGGSFIELD_CLI_PATH if it lives somewhere unusual.'
        : 'The render worker cannot execute the higgsfield CLI. Redeploy the Fly machine — the binary is installed by Dockerfile.ws.';
    case 'auth_required':
      return local
        ? 'The higgsfield CLI is signed out. In a terminal on the machine running the dev server, run `higgsfield auth login`, then retry.'
        : 'The render worker’s Higgsfield credentials have expired. Run `higgsfield auth login` locally, then re-mint the HIGGSFIELD_CREDENTIALS_JSON secret on the Fly machine.';
    case 'workspace_required':
      return local
        ? 'The Higgsfield CLI is signed in but no workspace is selected. Run `higgsfield workspace list`, then `higgsfield workspace set <workspace_id>` — or `higgsfield workspace unset` to bill your personal account.'
        : 'The render worker is signed in but no workspace is selected. Select one locally (`higgsfield workspace set <workspace_id>`), then re-mint HIGGSFIELD_CREDENTIALS_JSON so the worker picks it up.';
    case 'timed_out':
      return `Higgsfield did not respond within ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s. This is usually transient — retry in a moment.`;
    case 'worker_unreachable':
      return 'The Fly render worker is unreachable. Check that the machine is up and HIGGSFIELD_REMOTE_URL points at it.';
    case 'worker_secret_rejected':
      return 'The Fly render worker rejected the internal secret. INTERNAL_RENDER_SECRET must be set to the same value on both Vercel and Fly.';
    case 'parse_failed':
      return 'Higgsfield returned output this app could not read. The CLI version may have changed its JSON contract.';
    default:
      return 'The Higgsfield CLI failed. Check the detail below for the exact error it reported.';
  }
}

/** Transport-layer faults never prove a render is dead — they only prove we
 *  could not ask about it. Only a provider-REPORTED terminal status may mark a
 *  row failed; everything here stays pending until the reaper's TTL. */
export function isTransientHiggsfieldError(code: HiggsfieldErrorCode): boolean {
  return code !== 'parse_failed';
}

export class HiggsfieldCliVideoProvider {
  readonly providerId = HIGGSFIELD_VIDEO_PROVIDER;
  readonly modelVersion = HIGGSFIELD_SEEDANCE_MODEL;
  private readonly cliPath: string;

  constructor(cliPath = process.env.HIGGSFIELD_CLI_PATH ?? 'higgsfield') {
    this.cliPath = cliPath;
  }

  async startVideo(input: HiggsfieldStartVideoInput): Promise<HiggsfieldJobState> {
    ensureEnabled();
    // Without --prompt the CLI blocks reading stdin, and execFile leaves the
    // child's stdin an open pipe that is never written or closed — a guaranteed
    // 30s hang. Fail fast and locally instead.
    if (!input.prompt.trim()) {
      throw new HiggsfieldCliError(
        'Refusing to run the Higgsfield CLI with an empty prompt.',
        'cli_failed',
        'prompt was empty; the CLI would block reading stdin',
      );
    }
    const args = [
      'generate',
      'create',
      HIGGSFIELD_SEEDANCE_MODEL,
      '--prompt',
      input.prompt,
      '--aspect_ratio',
      input.aspectRatio ?? '9:16',
      '--duration',
      String(input.durationSeconds ?? 8),
      '--resolution',
      input.resolution ?? '720p',
      '--mode',
      input.mode ?? 'fast',
      '--json',
      '--no-color',
    ];
    if (input.genre) args.push('--genre', input.genre);

    const parsed = await this.runJson(args);
    return normalizeJobState(parsed);
  }

  async getJob(jobId: string): Promise<HiggsfieldJobState> {
    ensureEnabled();
    const parsed = await this.runJson(['generate', 'get', jobId, '--json', '--no-color']);
    return normalizeJobState(parsed, jobId);
  }

  /**
   * Cheap read-only liveness check for the VID preflight. Spends no credits and
   * answers "would a render work right now?" without starting one.
   *
   * Two commands, in precondition order, because neither alone tells the truth:
   *
   *   `model list`     — an authenticated call with NO workspace precondition.
   *                      This is the honest auth signal.
   *   `account status` — additionally requires a selected workspace (CLI 1.1.19
   *                      made that a hard error), so it reports "No workspace
   *                      selected" even when the credential is the real problem.
   *
   * Probing with `account status` alone therefore misreports a bad credential as
   * a workspace problem — observed live against 1.1.19 with 0.1.x-format
   * credentials on disk. Auth first, then workspace.
   */
  async probe(): Promise<VideoProviderProbe> {
    if (!isHiggsfieldVideoEnabled()) {
      return {
        transport: 'local_cli',
        state: 'disabled',
        detail: remediationFor('disabled', 'local_cli'),
      };
    }
    try {
      await this.runJson(['model', 'list', '--video', '--json', '--no-color']);
    } catch (err) {
      return { transport: 'local_cli', state: probeStateFromError(err), detail: probeDetail(err) };
    }
    try {
      await this.runJson(['account', 'status', '--json', '--no-color']);
      return { transport: 'local_cli', state: 'ready' };
    } catch (err) {
      return { transport: 'local_cli', state: probeStateFromError(err), detail: probeDetail(err) };
    }
  }

  private async runJson(args: string[]): Promise<unknown> {
    let stdout = '';
    try {
      const result = await execFileAsync(this.cliPath, args, {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (err) {
      throw normalizeCliError(err);
    }

    // Exit 0 does not imply success: cobra prints usage to STDOUT and exits 0
    // when a positional argument is missing. Parsing that as a job payload
    // yields a baffling 'parse_failed' instead of a configuration error.
    if (/^Usage:/m.test(stdout) || stdout.includes('Use "higgsfield')) {
      throw new HiggsfieldCliError(
        'Higgsfield CLI printed usage instead of running the command.',
        'cli_failed',
        `argv: ${args.join(' ')}`,
      );
    }

    try {
      return parseCliJson(stdout);
    } catch (err) {
      throw new HiggsfieldCliError(
        'Higgsfield CLI returned non-JSON output.',
        'parse_failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export interface VideoProviderProbe {
  transport: HiggsfieldTransport;
  state:
    | 'ready'
    | 'unauthed'
    | 'missing_cli'
    | 'no_workspace'
    | 'disabled'
    | 'unreachable'
    | 'secret_rejected'
    | 'error';
  detail?: string;
}

export function probeStateFromError(err: unknown): VideoProviderProbe['state'] {
  if (!(err instanceof HiggsfieldCliError)) return 'error';
  switch (err.code) {
    case 'auth_required':
      return 'unauthed';
    case 'missing_cli':
      return 'missing_cli';
    case 'workspace_required':
      return 'no_workspace';
    case 'disabled':
      return 'disabled';
    case 'worker_unreachable':
      return 'unreachable';
    case 'worker_secret_rejected':
      return 'secret_rejected';
    default:
      return 'error';
  }
}

export function probeDetail(err: unknown): string {
  return err instanceof HiggsfieldCliError ? err.remediation : String(err);
}

export function isHiggsfieldVideoEnabled(): boolean {
  return (
    process.env.HIGGSFIELD_VIDEO_ENABLED === 'true' || process.env.HIGGSFIELD_VIDEO_ENABLED === '1'
  );
}

const JOB_ID_KEYS = ['job_id', 'jobId', 'id', 'uuid', 'generation_id', 'generationId'];
const STATUS_KEYS = ['status', 'job_status', 'jobStatus', 'state'];
const RESULT_URL_KEYS = [
  'result_url',
  'resultUrl',
  'raw_url',
  'rawUrl',
  'output_url',
  'outputUrl',
  'video_url',
  'videoUrl',
  'url',
];

/**
 * Subtrees that hold INPUTS, never outputs. The generic deep search would
 * happily return `params.medias[0].data.url` — a start-image PNG — as the
 * "result URL" for an image-to-video job, which finalizeVideoJob would then
 * store as an .mp4. Our text-to-video payloads ship `medias: []`, so this is
 * insurance rather than a live bug, but the cost of being wrong is a corrupt
 * asset published as ready.
 */
const INPUT_SUBTREES = new Set(['params', 'medias', 'input', 'inputs', 'request']);
/** Never mistake a poster frame for the video itself. */
const NON_RESULT_KEYS = new Set(['thumbnail_url', 'thumbnailurl', 'preview_url', 'previewurl']);

export function normalizeJobState(raw: unknown, fallbackJobId?: string): HiggsfieldJobState {
  const jobId = pickString(raw, JOB_ID_KEYS) ?? findUuidLikeString(raw) ?? fallbackJobId;
  if (!jobId) {
    throw new HiggsfieldCliError(
      'Higgsfield CLI response did not include a job id.',
      'parse_failed',
      JSON.stringify(raw).slice(0, 500),
    );
  }

  const rawStatus = pickString(raw, STATUS_KEYS) ?? 'pending';
  return {
    jobId,
    status: normalizeProviderStatus(rawStatus),
    rawStatus,
    resultUrl: pickString(raw, RESULT_URL_KEYS),
    raw,
  };
}

/**
 * Resolve in the CALLER's priority order, top level first.
 *
 * `findString` iterates the payload's keys, so its `keys` array only ever acted
 * as a membership set — whichever key the server happened to emit first won,
 * regardless of the order we listed. Real Higgsfield payloads are flat
 * (`{id, params, status, created_at, result_url, ...}`), so a top-level pass
 * resolves everything and the deep search stays a fallback.
 */
function pickString(raw: unknown, keys: string[]): string | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
  }
  for (const key of keys) {
    const found = findString(raw, [key]);
    if (found) return found;
  }
  return null;
}

export function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('empty stdout');
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    const arrFirst = trimmed.indexOf('[');
    const arrLast = trimmed.lastIndexOf(']');
    if (arrFirst >= 0 && arrLast > arrFirst) {
      return JSON.parse(trimmed.slice(arrFirst, arrLast + 1));
    }
    throw new Error('no JSON object or array found');
  }
}

function ensureEnabled(): void {
  if (!isHiggsfieldVideoEnabled()) {
    throw new HiggsfieldCliError(
      'Seedance video generation is disabled. Set HIGGSFIELD_VIDEO_ENABLED=true to enable it.',
      'disabled',
    );
  }
}

function normalizeProviderStatus(status: string): string {
  const lower = status.trim().toLowerCase();
  if (
    ['completed', 'complete', 'succeeded', 'success', 'ready', 'done', 'finished'].includes(lower)
  ) {
    return 'ready';
  }
  if (
    [
      'failed',
      'error',
      'canceled',
      'cancelled',
      'nsfw',
      'moderated',
      'blocked',
      'rejected',
      'content_policy',
      'policy_violation',
    ].includes(lower)
  ) {
    return 'failed';
  }
  if (['queued', 'pending', 'processing', 'running', 'in_progress', 'started'].includes(lower)) {
    return lower;
  }
  return lower || 'pending';
}

/**
 * Node puts the ENTIRE argv into `err.message` — including `--prompt <text>`.
 * Our prompts are cyber briefs, so they routinely contain the words "token",
 * "auth" and "login". Classifying over `err.message` therefore reported
 * unrelated failures as authentication failures. Classify over STDERR only
 * (empirically where this CLI writes errors, exit 2 for auth / 1 for arg
 * errors), and redact the prompt before the detail is ever persisted or shown.
 */
export function redactPromptArg(detail: string): string {
  // Consume everything up to the next REAL flag (`--word`), not the next token
  // starting with `--`. Prompts are editorial prose and use bare `--` as an
  // em-dash constantly ("KEV -- CISA added CVE-2024-1234 -- patch now"), which
  // used to halt the match and leak the remainder of the prompt into `detail`
  // — a string that gets persisted to error_message and shown to the operator.
  return detail.replace(
    /(--prompt)[ \t]+(?:"[^"]*"|'[^']*'|[\s\S]*?(?=[ \t]--[a-z][a-z0-9_-]*(?:[ \t]|$)|$))/g,
    '$1 <redacted>',
  );
}

function normalizeCliError(err: unknown): HiggsfieldCliError {
  const nodeErr = err as {
    code?: string;
    killed?: boolean;
    signal?: string;
    message?: string;
    stderr?: string;
    stdout?: string;
  };
  const stderr = (nodeErr.stderr ?? '').trim();
  const detail = redactPromptArg(
    [nodeErr.stderr, nodeErr.stdout, nodeErr.message].filter(Boolean).join('\n'),
  );

  // 1. Binary missing/unusable. ENOENT covers "not on PATH"; the npm package
  //    ships a Node shim that instead exits 1 with its own message when the
  //    vendored Go binary is absent or can't exec (the likely Fly failure).
  if (
    nodeErr.code === 'ENOENT' ||
    nodeErr.code === 'EACCES' ||
    /^@higgsfield\/cli: (binary not found|failed to exec)/m.test(stderr)
  ) {
    return new HiggsfieldCliError(
      'Higgsfield CLI is not installed or not executable.',
      'missing_cli',
      detail,
    );
  }

  // 2. Timeout. execFile kills the child, leaving BOTH streams empty — so this
  //    must be detected structurally, before any text matching, or there is
  //    nothing left to match on except the command line.
  if (nodeErr.killed === true || nodeErr.signal === 'SIGTERM' || nodeErr.code === 'ETIMEDOUT') {
    return new HiggsfieldCliError(
      `Higgsfield CLI timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
      'timed_out',
      detail,
    );
  }

  // 3. Network faults BEFORE the auth test — "Cannot reach token endpoint" is a
  //    connectivity problem, and matching it as auth would send the operator to
  //    re-authenticate for a broken network.
  if (
    /cannot reach (?:token|refresh|device) endpoint|dial tcp|connection refused|no such host|i\/o timeout|EAI_AGAIN/i.test(
      stderr,
    )
  ) {
    return new HiggsfieldCliError(
      'Higgsfield CLI could not reach the Higgsfield API.',
      'cli_failed',
      detail,
    );
  }

  // 4. Signed in, but no billing workspace selected. CLI 1.1.19 made this a hard
  //    error on account/job commands; it is NOT an auth failure and sending the
  //    operator to re-login would not fix it.
  if (/no workspace selected|workspace set <workspace_id>/i.test(stderr)) {
    return new HiggsfieldCliError(
      'Higgsfield CLI has no workspace selected.',
      'workspace_required',
      detail,
    );
  }

  // 5. Real authentication states, matched on the CLI's own literal messages.
  //    'Stored credentials use an older auth flow' is CLI 1.1.19's response to a
  //    credentials.json written by the 0.1.x device flow — a re-login, not a
  //    generic failure.
  if (
    /not authenticated|session expired|authorization failed|refresh failed \(http 401|unauthori[sz]ed|invalid[ _]token|token (?:has )?expired|stored credentials|older auth flow/i.test(
      stderr,
    )
  ) {
    return new HiggsfieldCliError('Higgsfield CLI is not authenticated.', 'auth_required', detail);
  }

  return new HiggsfieldCliError('Higgsfield CLI command failed.', 'cli_failed', detail);
}

function findString(value: unknown, keys: string[]): string | null {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  const seen = new Set<unknown>();

  function walk(node: unknown): string | null {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }

    const record = node as Record<string, unknown>;
    for (const [key, val] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (NON_RESULT_KEYS.has(lower)) continue;
      if (wanted.has(lower) && typeof val === 'string' && val.trim()) {
        return val.trim();
      }
      if (wanted.has(lower) && typeof val === 'number' && Number.isFinite(val)) {
        return String(val);
      }
    }

    for (const [key, val] of Object.entries(record)) {
      // Don't descend into the request echo — those URLs are inputs.
      if (INPUT_SUBTREES.has(key.toLowerCase())) continue;
      const found = walk(val);
      if (found) return found;
    }
    return null;
  }

  return walk(value);
}

function findUuidLikeString(value: unknown): string | null {
  const seen = new Set<unknown>();
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function walk(node: unknown): string | null {
    if (typeof node === 'string' && uuidLike.test(node.trim())) return node.trim();
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }

    for (const val of Object.values(node as Record<string, unknown>)) {
      const found = walk(val);
      if (found) return found;
    }
    return null;
  }

  return walk(value);
}

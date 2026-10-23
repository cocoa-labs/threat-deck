import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFile = vi.hoisted(() => {
  const fn = vi.fn();
  const custom = Symbol.for('nodejs.util.promisify.custom');
  Object.defineProperty(fn, custom, {
    value: (file: string, args: string[], options: Record<string, unknown>) =>
      fn(file, args, options),
  });
  return fn;
});

vi.mock('node:child_process', () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}));

import {
  type HiggsfieldCliError,
  HiggsfieldCliVideoProvider,
  type HiggsfieldErrorCode,
  isHiggsfieldVideoEnabled,
  isTransientHiggsfieldError,
  normalizeJobState,
  parseCliJson,
  redactPromptArg,
  remediationFor,
} from './higgsfield-cli-video';

/**
 * Real `generate get --json` payload shape, taken verbatim from
 * aegis_generated_media.provider_payload on rows that rendered successfully.
 * The previous fixtures used invented keys (generation_id / state /
 * output.video_url) that appear in no Higgsfield response and in no struct tag
 * in the CLI binary — the suite was green but proved nothing.
 */
const REAL_COMPLETED_JOB = {
  id: 'e9b70876-6072-4f26-807f-8976e2c99c0b',
  job_set_type: 'seedance_2_0',
  display_name: 'Seedance 2.0',
  created_at: 1780438510.597022,
  status: 'completed',
  result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/e2c99c0b.mp4',
  params: {
    prompt: 'Create a vertical cinematic intelligence brief video…',
    aspect_ratio: '9:16',
    duration: 8,
    resolution: '720p',
    mode: 'fast',
    genre: 'noir',
    medias: [],
  },
};

describe('HiggsfieldCliVideoProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HIGGSFIELD_VIDEO_ENABLED = 'true';
    delete process.env.HIGGSFIELD_CLI_PATH;
  });

  it('parses JSON even when the CLI wraps it in text', () => {
    expect(parseCliJson('ok\n{"id":"job_1","status":"queued"}\n')).toEqual({
      id: 'job_1',
      status: 'queued',
    });
  });

  it('normalizes a real completed Seedance payload', () => {
    expect(normalizeJobState(REAL_COMPLETED_JOB)).toMatchObject({
      jobId: 'e9b70876-6072-4f26-807f-8976e2c99c0b',
      status: 'ready',
      rawStatus: 'completed',
      resultUrl: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/e2c99c0b.mp4',
    });
  });

  it('never returns an input media URL as the result URL', () => {
    // Image-to-video echoes the start image under params.medias. Returning that
    // would publish a PNG as a .mp4 marked ready.
    const withStartImage = {
      ...REAL_COMPLETED_JOB,
      result_url: undefined,
      params: {
        ...REAL_COMPLETED_JOB.params,
        medias: [{ role: 'start_image', data: { url: 'https://cdn.example/start.png' } }],
      },
    };
    expect(normalizeJobState(withStartImage).resultUrl).toBeNull();
  });

  it('prefers the result URL over a thumbnail', () => {
    expect(
      normalizeJobState({
        id: 'a',
        status: 'completed',
        thumbnail_url: 'https://cdn.example/poster.png',
        result_url: 'https://cdn.example/clip.mp4',
      }).resultUrl,
    ).toBe('https://cdn.example/clip.mp4');
  });

  it('reads job_status when the payload uses the CLI struct name', () => {
    expect(normalizeJobState({ id: 'a', job_status: 'completed' }).status).toBe('ready');
  });

  it('uses the requested job id as a fallback for get output', () => {
    expect(
      normalizeJobState(
        { status: 'completed', output_url: 'https://cdn.example/v.mp4' },
        'requested-job',
      ),
    ).toMatchObject({ jobId: 'requested-job', status: 'ready' });
  });

  it('normalizes create output that returns a bare job id array', () => {
    expect(normalizeJobState(['f9bc34ab-d982-4575-ac65-29f0f9986396'])).toMatchObject({
      jobId: 'f9bc34ab-d982-4575-ac65-29f0f9986396',
      status: 'pending',
      resultUrl: null,
    });
  });

  it('treats provider moderation statuses as failed', () => {
    expect(
      normalizeJobState({ id: 'f9bc34ab-d982-4575-ac65-29f0f9986396', status: 'nsfw' }),
    ).toMatchObject({
      status: 'failed',
      rawStatus: 'nsfw',
    });
  });

  it('is disabled unless the gate is explicitly true or 1', () => {
    delete process.env.HIGGSFIELD_VIDEO_ENABLED;
    expect(isHiggsfieldVideoEnabled()).toBe(false);
    process.env.HIGGSFIELD_VIDEO_ENABLED = '1';
    expect(isHiggsfieldVideoEnabled()).toBe(true);
  });

  it('sends the exact seedance_2_0 arg vector', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify(['f9bc34ab-d982-4575-ac65-29f0f9986396']),
      stderr: '',
    });

    const provider = new HiggsfieldCliVideoProvider('/usr/local/bin/higgsfield');
    await provider.startVideo({
      prompt: 'Generate a cinematic cyber recap.',
      aspectRatio: '9:16',
      durationSeconds: 8,
      resolution: '720p',
      mode: 'fast',
      genre: 'noir',
    });

    // Frozen, not arrayContaining: `generate create` whitelists UNKNOWN flags
    // into its params payload rather than erroring, so a rename from
    // --aspect_ratio to --aspect-ratio would fail silently at the server.
    // This assertion is the only thing that catches it.
    expect(mockExecFile.mock.calls[0]?.[1]).toEqual([
      'generate',
      'create',
      'seedance_2_0',
      '--prompt',
      'Generate a cinematic cyber recap.',
      '--aspect_ratio',
      '9:16',
      '--duration',
      '8',
      '--resolution',
      '720p',
      '--mode',
      'fast',
      '--json',
      '--no-color',
      '--genre',
      'noir',
    ]);
    expect(mockExecFile.mock.calls[0]?.[1]).not.toContain('--wait');
  });

  it('refuses an empty prompt instead of letting the CLI block on stdin', async () => {
    const provider = new HiggsfieldCliVideoProvider();
    await expect(provider.startVideo({ prompt: '   ' })).rejects.toMatchObject({
      name: 'HiggsfieldCliError',
    });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  // ─── Error classification ────────────────────────────────────────────────
  // Every string here is one the CLI actually emits (pulled from the vendored
  // Go binary). The old single regex — /auth|login|unauthorized|token/ over
  // stderr+stdout+message — got half of these backwards.

  const CLASSIFICATION_CASES: Array<{
    name: string;
    rejection: Record<string, unknown>;
    code: HiggsfieldErrorCode;
  }> = [
    {
      name: 'signed out',
      rejection: { stderr: 'Error: Not authenticated.\nHint: Run: hf auth login', code: 2 },
      code: 'auth_required',
    },
    {
      name: 'expired session (was misreported as cli_failed)',
      rejection: { stderr: 'Error: Session expired.', code: 2 },
      code: 'auth_required',
    },
    {
      name: 'failed refresh (was misreported as cli_failed)',
      rejection: { stderr: 'Refresh failed (HTTP 401): invalid_grant', code: 2 },
      code: 'auth_required',
    },
    {
      name: 'auth host unreachable (was misreported as auth_required)',
      rejection: { stderr: 'Cannot reach token endpoint.', code: 1 },
      code: 'cli_failed',
    },
    {
      name: 'CLI 1.1.19 rejecting 0.1.x-format credentials',
      rejection: {
        stderr: 'Error: Stored credentials use an older auth flow.\nHint: Run: hf auth login',
        code: 2,
      },
      code: 'auth_required',
    },
    {
      name: 'signed in but no workspace selected',
      rejection: {
        stderr: 'Error: No workspace selected.\nHint: Run: hf workspace set <workspace_id>',
        code: 4,
      },
      code: 'workspace_required',
    },
    {
      name: 'unknown flag',
      rejection: { stderr: 'Error: unknown flag: --bogus', code: 1 },
      code: 'cli_failed',
    },
    {
      name: 'binary absent',
      rejection: { code: 'ENOENT', message: 'spawn higgsfield ENOENT' },
      code: 'missing_cli',
    },
    {
      name: 'npm shim cannot exec the vendored binary',
      rejection: {
        stderr:
          '@higgsfield/cli: binary not found at /x/vendor/hf. Reinstall: npm i -g @higgsfield/cli',
        code: 1,
      },
      code: 'missing_cli',
    },
    {
      name: 'timeout — both streams empty, only argv left',
      rejection: {
        killed: true,
        signal: 'SIGTERM',
        stderr: '',
        stdout: '',
        message:
          'Command failed: higgsfield generate create seedance_2_0 --prompt OAuth token theft login montage',
      },
      code: 'timed_out',
    },
  ];

  for (const testCase of CLASSIFICATION_CASES) {
    it(`classifies ${testCase.name} as ${testCase.code}`, async () => {
      mockExecFile.mockRejectedValueOnce(testCase.rejection);
      const provider = new HiggsfieldCliVideoProvider();
      await expect(provider.startVideo({ prompt: 'x' })).rejects.toMatchObject({
        name: 'HiggsfieldCliError',
        code: testCase.code,
      } satisfies Partial<HiggsfieldCliError>);
    });
  }

  it('does not read the prompt when classifying — a cyber prompt is not an auth failure', async () => {
    // Node embeds the whole argv in err.message. Our prompts are threat briefs,
    // so "token"/"auth"/"login" appear constantly.
    mockExecFile.mockRejectedValueOnce({
      stderr: 'Error: Internal server error.',
      stdout: '',
      message:
        'Command failed: higgsfield generate create seedance_2_0 --prompt OAuth token theft: login credential auth bypass',
    });
    const provider = new HiggsfieldCliVideoProvider();
    await expect(provider.startVideo({ prompt: 'OAuth token theft' })).rejects.toMatchObject({
      code: 'cli_failed',
    });
  });

  it('redacts the prompt from stored error detail', () => {
    expect(
      redactPromptArg(
        'Command failed: higgsfield generate create seedance_2_0 --prompt Secret brief text --aspect_ratio 9:16',
      ),
    ).toBe(
      'Command failed: higgsfield generate create seedance_2_0 --prompt <redacted> --aspect_ratio 9:16',
    );
  });

  it.each([
    // Editorial prose uses a bare `--` as an em-dash constantly. Halting the
    // match there leaked the rest of the prompt into `detail`, which is
    // persisted to error_message and shown to the operator.
    [
      'bare -- inside the prompt',
      'hf create --prompt KEV -- CISA added CVE-2024-1234 -- patch now --aspect_ratio 9:16',
    ],
    ['double-quoted prompt', 'hf create --prompt "quoted -- prompt" --duration 8'],
    ['single-quoted prompt', "hf create --prompt 'quoted -- prompt' --duration 8"],
    [
      'prompt as the final argument',
      'hf create seedance_2_0 --prompt trailing text with no flags after',
    ],
    ['multiline prompt', 'hf create --prompt line one\nline two -- dashes\nline three --mode fast'],
  ])('redacts fully: %s', (_name, input) => {
    const out = redactPromptArg(input);
    expect(out).toContain('--prompt <redacted>');
    expect(out).not.toMatch(/CISA|quoted|trailing text|line two/);
  });

  it('leaves output without a prompt untouched', () => {
    expect(redactPromptArg('hf model list --json --no-color')).toBe(
      'hf model list --json --no-color',
    );
  });

  it('raises a configuration error when the CLI prints usage on exit 0', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: 'Create a generation job.\n\nUsage:\n  higgsfield generate create <job_set_type>\n',
      stderr: '',
    });
    const provider = new HiggsfieldCliVideoProvider();
    await expect(provider.startVideo({ prompt: 'x' })).rejects.toMatchObject({
      code: 'cli_failed',
    });
  });

  // ─── Remediation copy ────────────────────────────────────────────────────

  it('does not tell a deployed operator to edit .env.local', () => {
    const original = process.env.VERCEL;
    try {
      process.env.VERCEL = '1';
      const deployed = remediationFor('disabled', 'local_cli');
      expect(deployed).not.toContain('.env.local');
      expect(deployed).toContain('render worker');
    } finally {
      if (original === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = original;
    }
  });

  it('does not mistake a missing workspace for an auth failure', () => {
    // CLI 1.1.19 made workspace selection a hard precondition. Sending the
    // operator to re-login would not fix it.
    expect(remediationFor('workspace_required', 'local_cli')).toContain('workspace set');
    expect(remediationFor('workspace_required', 'local_cli')).not.toContain('auth login');
  });

  it('gives transport-specific remediation for the same failure', () => {
    const local = remediationFor('auth_required', 'local_cli');
    const remote = remediationFor('auth_required', 'remote_worker');
    expect(local).toContain('higgsfield auth login');
    expect(local).toContain('dev server');
    // Telling a production operator to run a local login is the wrong advice —
    // the worker reads its credentials from a Fly secret.
    expect(remote).toContain('HIGGSFIELD_CREDENTIALS_JSON');
  });

  it('treats transport faults as transient so a live render is not killed', () => {
    expect(isTransientHiggsfieldError('timed_out')).toBe(true);
    expect(isTransientHiggsfieldError('cli_failed')).toBe(true);
    expect(isTransientHiggsfieldError('worker_unreachable')).toBe(true);
    expect(isTransientHiggsfieldError('auth_required')).toBe(true);
    expect(isTransientHiggsfieldError('parse_failed')).toBe(false);
  });
});

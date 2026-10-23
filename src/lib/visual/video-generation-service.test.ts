import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
const mockUploadVisualBlob = vi.hoisted(() => vi.fn());
const mockStartVideo = vi.hoisted(() => vi.fn());
const mockGetJob = vi.hoisted(() => vi.fn());
const mockSpendCheck = vi.hoisted(() => vi.fn());
const MockHiggsfieldCliError = vi.hoisted(
  () =>
    class HiggsfieldCliError extends Error {
      constructor(
        message: string,
        public readonly code:
          | 'disabled'
          | 'missing_cli'
          | 'auth_required'
          | 'timed_out'
          | 'cli_failed'
          | 'parse_failed'
          | 'worker_unreachable'
          | 'worker_secret_rejected',
        public readonly detail?: string,
        public readonly transport: 'local_cli' | 'remote_worker' = 'local_cli',
      ) {
        super(message);
        this.name = 'HiggsfieldCliError';
      }

      get remediation(): string {
        return `remediation:${this.code}:${this.transport}`;
      }
    },
);

vi.mock('@/lib/db/client', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock('@/lib/storage/vercel-blob', () => ({
  uploadVisualBlob: (...args: unknown[]) => mockUploadVisualBlob(...args),
}));

vi.mock('@/lib/visual/providers/higgsfield-cli-video', () => ({
  HIGGSFIELD_SEEDANCE_MODEL: 'seedance_2_0',
  HIGGSFIELD_VIDEO_PROVIDER: 'higgsfield_cli',
  HiggsfieldCliError: MockHiggsfieldCliError,
  isTransientHiggsfieldError: (code: string) => code !== 'parse_failed',
  HiggsfieldCliVideoProvider: vi.fn().mockImplementation(() => ({
    startVideo: (...args: unknown[]) => mockStartVideo(...args),
    getJob: (...args: unknown[]) => mockGetJob(...args),
  })),
}));

// The service selects its provider via the factory; pin it to the mocked CLI
// provider so these tests are independent of HIGGSFIELD_REMOTE_URL.
vi.mock('@/lib/visual/providers/video-provider', () => ({
  getVideoProvider: () => ({
    startVideo: (...args: unknown[]) => mockStartVideo(...args),
    getJob: (...args: unknown[]) => mockGetJob(...args),
  }),
}));

vi.mock('@/lib/security/visual-spend', () => ({
  checkOutboundVisualSpend: (...args: unknown[]) => mockSpendCheck(...args),
}));

vi.mock('@/lib/audit', () => ({
  AUDIT_ACTIONS: {
    OUTBOUND_VISUAL_BLOCKED_COST: 'outbound.visual_blocked_cost',
    OUTBOUND_VISUAL_FAILED: 'outbound.visual_failed',
  },
  recordAudit: vi.fn(),
}));

import { refreshGeneratedVideoIfNeeded, startVideoGeneration } from './video-generation-service';

function rows(value: unknown[]): { rows: unknown[]; rowCount: number } {
  return { rows: value, rowCount: value.length };
}

describe('video-generation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpendCheck.mockResolvedValue({
      allowed: true,
      estimatedSpend24hUsd: 0,
      warnCapUsd: 15,
      hardCapUsd: 25,
      warningTriggered: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(2048), {
          headers: { 'content-type': 'video/mp4' },
        }),
      ),
    );
    mockUploadVisualBlob.mockResolvedValue({
      url: 'https://blob.example/outbound-videos/seedance/10.mp4',
      size: 2048,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a Higgsfield Seedance job and stores provider state', async () => {
    mockQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ id: '10' }]));
    mockStartVideo.mockResolvedValueOnce({
      jobId: 'hf-job-10',
      status: 'queued',
      rawStatus: 'queued',
      resultUrl: null,
      raw: { job_id: 'hf-job-10', status: 'queued' },
    });

    const result = await startVideoGeneration({
      content: '## BLUF\nA critical breach report needs a cinematic recap.',
      messageTimestamp: 1779000000000,
    });

    expect(result).toMatchObject({
      ok: true,
      mediaKind: 'video',
      generatedMediaId: '10',
      status: 'pending',
      pollUrl: '/api/outbound/generated-media/10',
    });
    expect(mockStartVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        aspectRatio: '9:16',
        durationSeconds: 8,
        mode: 'fast',
        resolution: '720p',
      }),
    );
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO aegis_generated_media'),
    );
    expect(insertCall?.[1]).toEqual(expect.arrayContaining(['hf-job-10', 'queued']));
  });

  it('preserves benign fictional presenter direction instead of forcing abstract-only video', async () => {
    mockQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ id: '12' }]));
    mockStartVideo.mockResolvedValueOnce({
      jobId: 'hf-job-12',
      status: 'queued',
      rawStatus: 'queued',
      resultUrl: null,
      raw: { job_id: 'hf-job-12', status: 'queued' },
    });

    await startVideoGeneration({
      content:
        'Create a 15-second explainer with a fictional adult blonde-haired, blue-eyed woman presenter explaining the Reform UK report.',
    });

    const startArgs = mockStartVideo.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(startArgs?.prompt).toContain('fictional adult professional presenter');
    expect(startArgs?.prompt).toContain('blonde-haired, blue-eyed woman presenter');
    expect(startArgs?.prompt).not.toContain('No human subjects');
    expect(startArgs?.prompt).not.toContain('abstract-only');
    expect(startArgs?.prompt).not.toMatch(/\b(gore|minors|sexualized|physical harm)\b/i);
  });

  it('records a failed row and surfaces transport-aware remediation when the CLI is disabled', async () => {
    mockQuery.mockResolvedValueOnce(rows([])); // dedup lookup
    mockQuery.mockResolvedValueOnce(rows([{ id: '99' }])); // failure row insert
    mockStartVideo.mockRejectedValueOnce(
      new MockHiggsfieldCliError(
        'Seedance video generation is disabled. Set HIGGSFIELD_VIDEO_ENABLED=true to enable it.',
        'disabled',
      ),
    );

    const result = await startVideoGeneration({ content: 'Make a Seedance clip.' });

    // The operator is shown the remediation, not the raw provider message.
    expect(result).toMatchObject({
      ok: false,
      mediaKind: 'video',
      error: 'disabled',
      instruction: 'remediation:disabled:local_cli',
    });

    // A start-time failure must leave a trace. Previously nothing was written:
    // no row, no audit, no log — the error died with the popover.
    const insert = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO aegis_generated_media'),
    );
    expect(insert).toBeDefined();
    expect(String(insert?.[0])).toContain("'failed'");
  });

  it('refreshes a completed provider job, uploads the MP4, and marks the row ready', async () => {
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          id: '10',
          status: 'pending',
          blob_url: null,
          provider: 'higgsfield_cli',
          provider_job_id: 'hf-job-10',
          provider_status: 'processing',
          style_tag: 'seedance_vertical',
        },
      ]),
    );
    mockGetJob.mockResolvedValueOnce({
      jobId: 'hf-job-10',
      status: 'ready',
      rawStatus: 'completed',
      resultUrl: 'https://higgsfield.example/result.mp4',
      raw: { status: 'completed', output_url: 'https://higgsfield.example/result.mp4' },
    });

    // finalizeVideoJob claims the row before downloading so two concurrent
    // pollers can't both fetch and upload the same MP4.
    mockQuery.mockResolvedValueOnce(rows([{ id: '10' }]));

    await refreshGeneratedVideoIfNeeded('10');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://higgsfield.example/result.mp4',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(mockUploadVisualBlob).toHaveBeenCalledWith(
      'outbound-videos/seedance/10.mp4',
      expect.any(Buffer),
      { contentType: 'video/mp4' },
    );
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'ready'"),
    );
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining(['10', 'https://blob.example/outbound-videos/seedance/10.mp4']),
    );
  });

  it('marks failed provider jobs as failed without downloading', async () => {
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          id: '11',
          status: 'pending',
          blob_url: null,
          provider: 'higgsfield_cli',
          provider_job_id: 'hf-job-11',
          provider_status: 'processing',
          style_tag: 'seedance_vertical',
        },
      ]),
    );
    mockGetJob.mockResolvedValueOnce({
      jobId: 'hf-job-11',
      status: 'failed',
      rawStatus: 'nsfw',
      resultUrl: null,
      raw: { status: 'nsfw' },
    });

    await refreshGeneratedVideoIfNeeded('11');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('SET status = $2'),
    );
    expect(updateCall?.[1]).toEqual([
      '11',
      'failed',
      'nsfw',
      JSON.stringify({ status: 'nsfw' }),
      'Higgsfield moderation blocked this Seedance prompt (nsfw). Try a more neutral editorial wording or regenerate.',
    ]);
  });

  it('leaves a live render pending when a transient transport error interrupts polling', async () => {
    // A fly deploy, a cold start past the abort, or one 502 used to write
    // status='failed' — which is terminal — killing a job that was still
    // rendering fine and still burning credits.
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          id: '12',
          status: 'pending',
          blob_url: null,
          provider: 'higgsfield_cli',
          provider_job_id: 'hf-job-12',
          provider_status: 'processing',
          style_tag: 'seedance_vertical',
        },
      ]),
    );
    mockGetJob.mockRejectedValueOnce(
      new MockHiggsfieldCliError('Remote render worker is unreachable.', 'worker_unreachable'),
    );

    await refreshGeneratedVideoIfNeeded('12');

    const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => sql.includes("SET status = 'failed'"))).toBe(false);
    // The attempt is counted so the reaper can eventually give up.
    const pollFailureSql = sqls.find((sql) => sql.includes('__pollFailures'));
    expect(pollFailureSql).toBeDefined();
    // provider_payload can be a bare ARRAY (create can answer with a list of
    // job ids), and jsonb_set on an array with a text path raises
    // "path element at position 1 is not an integer" — which would abort the
    // very bookkeeping that keeps a render from getting stuck.
    expect(pollFailureSql).toContain("jsonb_typeof(provider_payload) = 'object'");
  });

  it('still marks failed when the payload itself cannot be parsed', async () => {
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          id: '13',
          status: 'pending',
          blob_url: null,
          provider: 'higgsfield_cli',
          provider_job_id: 'hf-job-13',
          provider_status: 'processing',
          style_tag: 'seedance_vertical',
        },
      ]),
    );
    mockGetJob.mockRejectedValueOnce(new MockHiggsfieldCliError('unreadable', 'parse_failed'));

    await refreshGeneratedVideoIfNeeded('13');

    const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => sql.includes("SET status = 'failed'"))).toBe(true);
  });

  it('reports a create-time moderation rejection as a failure, not as "started"', async () => {
    mockQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ id: '14' }]));
    mockStartVideo.mockResolvedValueOnce({
      jobId: 'hf-job-14',
      status: 'failed',
      rawStatus: 'nsfw',
      resultUrl: null,
      raw: { status: 'nsfw' },
    });

    const result = await startVideoGeneration({ content: 'A breach recap.' });

    expect(result).toMatchObject({ ok: false, status: 'failed', error: 'provider_rejected' });
    expect(result.instruction).toContain('moderation');
  });

  it('includes the render knobs in the dedup identity', async () => {
    // Same message at a different Length/Format/Genre is a DIFFERENT render.
    // Hashing only the prompt meant changing the popover knobs silently
    // returned the previous clip.
    const hashes: string[] = [];
    for (const durationSeconds of [8, 12]) {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ id: '15' }]));
      mockStartVideo.mockResolvedValueOnce({
        jobId: 'j',
        status: 'queued',
        rawStatus: 'queued',
        resultUrl: null,
        raw: {},
      });
      await startVideoGeneration({ content: 'Same message.', durationSeconds });
      const select = mockQuery.mock.calls[0];
      const params = (select?.[1] ?? []) as unknown[];
      hashes.push(String(params[0]));
    }
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('refuses to write ready when the provider gives no result URL', async () => {
    // 'ready' + blob_url NULL is unrecoverable: refresh early-returns on ready,
    // the reaper only scans pending, and the poll route only refreshes pending —
    // so the row is "done" forever with nothing to play, while dedup tells Max
    // the video is attached.
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          id: '16',
          status: 'pending',
          blob_url: null,
          provider: 'higgsfield_cli',
          provider_job_id: 'hf-job-16',
          provider_status: 'processing',
          style_tag: 'seedance_vertical',
        },
      ]),
    );
    mockGetJob.mockResolvedValueOnce({
      jobId: 'hf-job-16',
      status: 'ready',
      rawStatus: 'completed',
      resultUrl: null,
      raw: { status: 'completed' },
    });

    await refreshGeneratedVideoIfNeeded('16');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    const statusUpdate = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('SET status = $2'),
    );
    const statusParams = (statusUpdate?.[1] ?? []) as unknown[];
    expect(statusParams[1]).toBe('pending');
  });

  it.each([
    // Exact expected values from the measured credits/sec table, x $0.05/credit.
    // Verified against `higgsfield generate cost` per cell — see the table in
    // video-generation-service.ts.
    ['720p', 8, 1.4], // 3.5/s  — the historic default
    ['720p', 15, 2.63], // the new maximum length
    ['1080p', 15, 6.75], // 9.0/s, promoted to mode std
    ['4k', 15, 16.5], // 22.0/s — 6.3x a 720p clip of the same length
  ])('books the real cost for %s at %ss', async (resolution, durationSeconds, expected) => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ id: '17' }]));
    mockStartVideo.mockResolvedValueOnce({
      jobId: 'j',
      status: 'queued',
      rawStatus: 'queued',
      resultUrl: null,
      raw: {},
    });

    await startVideoGeneration({ content: 'Cost check.', durationSeconds, resolution });

    const insert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO aegis_generated_media'),
    );
    const params = (insert?.[1] ?? []) as unknown[];
    expect(Number(params[15])).toBe(expected);
  });
});

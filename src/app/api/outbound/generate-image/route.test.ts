/**
 * Tests for POST /api/outbound/generate-image.
 *
 * These lock the route to the generated-media visual V2 schema. The
 * IMG button broke when the route used stale column names, so the happy-path
 * assertions inspect the SQL contract as well as the JSON response.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.fn();
const mockQuery = vi.fn();
const mockSpendCheck = vi.fn();
const mockGenerateInfographic = vi.fn();
const mockRecordAudit = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/db/client', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock('@/lib/security/visual-spend', () => ({
  checkOutboundVisualSpend: (...args: unknown[]) => mockSpendCheck(...args),
}));

vi.mock('@/lib/visual/orchestrator', () => ({
  generateInfographic: (...args: unknown[]) => mockGenerateInfographic(...args),
}));

vi.mock('@/lib/audit', () => ({
  AUDIT_ACTIONS: {
    OUTBOUND_VISUAL_BLOCKED_COST: 'outbound.visual_blocked_cost',
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  getClientIp: () => 'test-ip',
  withRateLimit: <H extends (req: Request, ctx?: unknown) => Response | Promise<Response>>(
    handler: H,
  ): H => handler,
}));

const { POST } = await import('./route');

function mkReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/outbound/generate-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function defaultQuery(sql: unknown): Promise<{ rows: unknown[]; rowCount: number }> {
  const text = String(sql);
  if (text.includes('SELECT id::text')) {
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  if (text.includes('INSERT INTO aegis_generated_media')) {
    return Promise.resolve({ rows: [{ id: '101' }], rowCount: 1 });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}

function queryCalls(): Array<[string, unknown[] | undefined]> {
  return mockQuery.mock.calls.map(([sql, params]) => [String(sql), params as unknown[]]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
  mockSpendCheck.mockResolvedValue({
    allowed: true,
    estimatedSpend24hUsd: 0,
    warnCapUsd: 15,
    hardCapUsd: 25,
    warningTriggered: false,
  });
  mockQuery.mockImplementation(defaultQuery);
  mockGenerateInfographic.mockResolvedValue(undefined);
});

describe('POST /api/outbound/generate-image', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    const res = await POST(mkReq({ messageContent: 'hello' }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when messageContent is missing', async () => {
    const res = await POST(mkReq({ messageTimestamp: 1779000000000 }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'messageContent is required',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('inserts a pending generated-media row with VisualBrief provenance', async () => {
    const res = await POST(
      mkReq({
        messageContent:
          '## BLUF\n**[CRITICAL]** CVE image fixture. CVSS: 9.8 EPSS: 0.92\n\n## KEY FINDINGS\n- Exploitation is active.\n- Patch immediately.\n\n**Sources:**\n- [VERIFIED] [CISA KEV](/api/aegis/kev/view?id=CVE-2099-00010)',
        messageTimestamp: 1779000000001,
        entityKind: 'kev',
        entityId: 'CVE-2099-00010',
        severity: 'critical',
        bluf: 'CVE image fixture.',
        sourceContext: {
          sourcePanel: 'kevAlerts',
          dataType: 'kev',
          trendData: { sourceUrl: '/api/aegis/kev/view?id=CVE-2099-00010' },
        },
      }),
    );

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      generatedMediaId: '101',
      status: 'pending',
      pollUrl: '/api/outbound/generated-media/101',
    });

    const calls = queryCalls();
    const selectSql = calls[0]?.[0] ?? '';
    const insertCall = calls.find(([sql]) => sql.includes('INSERT INTO aegis_generated_media'));
    const insertSql = insertCall?.[0] ?? '';
    const insertParams = insertCall?.[1] ?? [];

    expect(selectSql).toContain('source_agent_message_hash');
    expect(selectSql).toContain("media_kind = 'image'");
    expect(selectSql).not.toContain('WHERE message_hash');

    expect(insertSql).toContain('media_kind');
    expect(insertSql).toContain('source_agent_message_ts');
    expect(insertSql).toContain('source_agent_message_hash');
    expect(insertSql).toContain('visual_schema_version');
    expect(insertSql).toContain('visual_payload');
    expect(insertSql).toContain('source_context');
    expect(insertSql).not.toContain('message_content');
    expect(insertSql).not.toContain('message_timestamp');
    expect(insertSql).not.toContain('updated_at');
    expect(insertParams).toContain('openai_gpt_image_2');
    expect(insertParams).toContain('gpt-image-2-2026-04-21');
    expect(insertParams).toContain(1779000000001);
    expect(insertParams).toContain('visual-v2');
    expect(insertParams.some((p) => typeof p === 'string' && p.includes('"title"'))).toBe(true);
    expect(insertParams.some((p) => typeof p === 'string' && p.includes('kevAlerts'))).toBe(true);

    expect(mockGenerateInfographic).toHaveBeenCalledOnce();
    expect(mockGenerateInfographic.mock.calls[0]?.[0]).toMatchObject({
      generatedMediaId: '101',
      styleTag: 'kev_pressure',
      entityKind: 'kev',
      entityId: 'CVE-2099-00010',
      severity: 'critical',
      visualBrief: {
        schemaVersion: 'visual-v2',
        severity: 'critical',
        entityId: 'CVE-2099-00010',
        sourcePanel: 'kevAlerts',
      },
      sourceContext: {
        sourcePanel: 'kevAlerts',
      },
    });
  });

  it('dedups against an existing pending row for the same V2 message/context/style', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '44', blob_url: null, status: 'pending' }],
      rowCount: 1,
    });

    const res = await POST(
      mkReq({
        messageContent: '**[HIGH]** Duplicate image fixture.',
        messageTimestamp: 1779000000002,
        styleTag: 'crt_terminal',
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      generatedMediaId: '44',
      status: 'pending',
      blobUrl: null,
      dedup: true,
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockGenerateInfographic).not.toHaveBeenCalled();
  });

  it('returns JSON when a DB/schema error occurs', async () => {
    mockQuery.mockRejectedValueOnce(new Error('column message_hash does not exist'));

    const res = await POST(mkReq({ messageContent: 'broken schema fixture' }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'generate_image_failed',
      detail: expect.stringContaining('column message_hash'),
    });
  });
});

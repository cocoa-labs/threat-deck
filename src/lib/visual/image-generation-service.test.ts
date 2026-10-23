import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
const mockSpendCheck = vi.hoisted(() => vi.fn());
const mockGenerateInfographic = vi.hoisted(() => vi.fn());
const mockRecordAudit = vi.hoisted(() => vi.fn());

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

import { startImageGeneration } from './image-generation-service';

function rows(value: unknown[]): { rows: unknown[]; rowCount: number } {
  return { rows: value, rowCount: value.length };
}

describe('startImageGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpendCheck.mockResolvedValue({
      allowed: true,
      estimatedSpend24hUsd: 0,
      warnCapUsd: 15,
      hardCapUsd: 25,
      warningTriggered: false,
    });
    mockGenerateInfographic.mockResolvedValue(undefined);
    mockRecordAudit.mockResolvedValue(undefined);
  });

  it('blocks before DB work when the visual spend cap is exhausted', async () => {
    mockSpendCheck.mockResolvedValueOnce({
      allowed: false,
      estimatedSpend24hUsd: 26,
      warnCapUsd: 15,
      hardCapUsd: 25,
      warningTriggered: true,
      reason: 'hard_cap',
    });

    const result = await startImageGeneration({
      messageContent: 'Generate a critical CVE infographic.',
      actorEmail: 'alice@example.org',
    });

    expect(result).toMatchObject({
      ok: false,
      mediaKind: 'image',
      error: 'visual_spend_cap_exceeded',
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'outbound.visual_blocked_cost',
        actorId: 'alice@example.org',
      }),
    );
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGenerateInfographic).not.toHaveBeenCalled();
  });

  it('dedups against an existing pending generated image row', async () => {
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          id: '42',
          blob_url: null,
          status: 'pending',
          style_tag: 'crt_terminal',
        },
      ]),
    );

    const result = await startImageGeneration({
      messageContent: 'Make an infographic from this report.',
      styleTag: 'crt_terminal',
    });

    expect(result).toMatchObject({
      ok: true,
      mediaKind: 'image',
      generatedMediaId: '42',
      status: 'pending',
      dedup: true,
      pollUrl: '/api/outbound/generated-media/42',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockGenerateInfographic).not.toHaveBeenCalled();
  });

  it('inserts a pending row and starts the shared infographic orchestrator', async () => {
    mockQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ id: '101' }]));

    const result = await startImageGeneration({
      messageContent: '**[CRITICAL]** CVE-2099-00010 active exploitation.\n\nCVSS: 9.8\nEPSS: 0.92',
      messageTimestamp: 1779000000000,
      entityKind: 'kev',
      entityId: 'CVE-2099-00010',
      severity: 'critical',
      sourceContext: {
        sourcePanel: 'kevAlerts',
        dataType: 'kev',
        trendData: { sourceUrl: '/api/aegis/kev/view?id=CVE-2099-00010' },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      mediaKind: 'image',
      generatedMediaId: '101',
      status: 'pending',
      styleTag: 'kev_pressure',
    });
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO aegis_generated_media'),
    );
    expect(insertCall?.[1]).toEqual(
      expect.arrayContaining(['openai_gpt_image_2', 'gpt-image-2-2026-04-21', 'visual-v2']),
    );
    expect(mockGenerateInfographic).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedMediaId: '101',
        styleTag: 'kev_pressure',
        entityKind: 'kev',
        entityId: 'CVE-2099-00010',
      }),
    );
  });
});

/**
 * Tests for the Phase 10.2 Haiku augmentation tier.
 *
 * Mocks the Anthropic SDK so we exercise the shape-validation + fail-soft
 * paths without burning API budget. The orchestration story for these tests:
 *
 *   - happy: Haiku returns valid JSON → caller gets a PivotSuggestion
 *     with source='haiku'
 *   - shape failure: Haiku returns malformed JSON → null + audit
 *   - missing ANTHROPIC_API_KEY: short-circuit null (no SDK call attempted)
 *   - "deep analysis" filter: Haiku returns a verbose label → null (rule #26)
 *   - timeout / SDK throw: null + audit
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PivotEntityRow } from './pivot-templates';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  },
}));

// Unbounded vi.fn() so `mock.calls[i]` indexes into a `unknown[][]` rather
// than `[][]` (which a typed 0-arg impl would produce and which makes
// `calls[0]?.[0]` a type error).
const recordAuditMock = vi.fn();
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return {
    ...actual,
    recordAudit: recordAuditMock,
  };
});

const { generateHaikuPivot } = await import('./pivot-haiku');

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  mockCreate.mockReset();
  recordAuditMock.mockClear();
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  }
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const actorEntity: PivotEntityRow = {
  kind: 'threat_actor',
  data: {
    actor_id: 'LockBit',
    display_name: 'LockBit',
    aliases: ['Bitwise Spider'],
    attribution_country: 'RU',
    last_active_at: '2025-05-20T12:00:00Z',
    composite_score: 88,
    actor_grade: 'A',
    top_sector: 'Healthcare',
    peer_actor_display_name: 'BlackCat',
    campaign_count: 12,
    target_count: 47,
  },
};

const existingTemplates = [
  {
    label: 'Find LockBit victims in Healthcare (30d)',
    prefillPrompt: 'Find LockBit victims in Healthcare sector …',
    contextNeeded: ['display_name', 'top_sector'],
    rank: 0,
    source: 'template' as const,
  },
];

function mockHaikuResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateHaikuPivot', () => {
  it('parses a well-formed JSON response into a PivotSuggestion', async () => {
    mockHaikuResponse(
      JSON.stringify({
        label: 'Map LockBit infrastructure overlap with Conti',
        prefillPrompt:
          'Map shared C2 infrastructure between LockBit and Conti. Include IP overlap, certificate reuse, and JARM fingerprints.',
        contextNeeded: ['display_name'],
      }),
    );

    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).not.toBeNull();
    expect(result?.source).toBe('haiku');
    expect(result?.label).toBe('Map LockBit infrastructure overlap with Conti');
    expect(result?.contextNeeded).toEqual(['display_name']);
    expect(result?.rank).toBe(existingTemplates.length);
  });

  it('returns null when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null + audits when Haiku returns malformed JSON', async () => {
    mockHaikuResponse('not valid json at all');
    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).toBeNull();
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    const auditArg = recordAuditMock.mock.calls[0]?.[0] as unknown as { action: string };
    expect(auditArg.action).toBe('data.haiku_parse_failed');
  });

  it('returns null when Haiku returns missing fields', async () => {
    mockHaikuResponse(JSON.stringify({ label: 'only a label' })); // no prefillPrompt
    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).toBeNull();
  });

  it('rejects "deep analysis" verbose labels (rule #26)', async () => {
    mockHaikuResponse(
      JSON.stringify({
        label: 'Deep analysis of LockBit infrastructure',
        prefillPrompt: 'Run a deep analysis of …',
        contextNeeded: ['display_name'],
      }),
    );
    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).toBeNull();
  });

  it('truncates an overlong label to 60 chars', async () => {
    const longLabel = 'A'.repeat(120);
    mockHaikuResponse(
      JSON.stringify({
        label: longLabel,
        prefillPrompt: 'some prompt',
        contextNeeded: [],
      }),
    );
    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).not.toBeNull();
    expect(result?.label.length).toBe(60);
  });

  it('returns null + audits when the SDK throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('upstream timeout'));
    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).toBeNull();
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
  });

  it('still parses JSON wrapped in code fences', async () => {
    mockHaikuResponse(
      '```json\n' +
        JSON.stringify({
          label: 'Compare LockBit dwell time to peer median',
          prefillPrompt: 'Compute median dwell time …',
          contextNeeded: ['display_name'],
        }) +
        '\n```',
    );
    const result = await generateHaikuPivot(actorEntity, existingTemplates);
    expect(result).not.toBeNull();
    expect(result?.label).toBe('Compare LockBit dwell time to peer median');
  });
});

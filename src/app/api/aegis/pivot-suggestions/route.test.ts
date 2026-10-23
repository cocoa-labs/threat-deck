/**
 * Tests for the Phase 10.1 pivot-suggestions API route.
 *
 * Mocks loadEntityRow + the Haiku generator + the rate-limiter cache so we
 * exercise the route's responsibilities in isolation:
 *
 *   - 400 on invalid kind / missing entityId
 *   - 200 with empty suggestions when entity not found in DB (cached 5min)
 *   - 200 with templated pivots when entity exists, no Haiku augmentation
 *     for low-relevance entities
 *   - 200 with Haiku-augmented pivots for high-relevance entities
 *   - 200 with empty suggestions on internal failure (fail-soft)
 *   - Cache hit short-circuits — second call doesn't re-hit loadEntityRow
 *   - Haiku tier respects rate-limit fallback (templates returned alone)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PivotEntityRow, PivotSuggestion } from '@/lib/aegis/pivot-templates';

// Mocks are declared without an implementation so vi.fn() returns
// Mock<UnknownFunction> — that lets us spread `...unknown[]` args into them
// from the vi.mock() factories below without TS narrowing complaints.
const mockLoadEntityRow = vi.fn();
const mockGenerateHaikuPivot = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetCached = vi.fn();
const mockSetCache = vi.fn();

vi.mock('@/lib/aegis/pivot-templates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/aegis/pivot-templates')>(
    '@/lib/aegis/pivot-templates',
  );
  return {
    ...actual,
    loadEntityRow: (...a: unknown[]) => mockLoadEntityRow(...a),
  };
});

vi.mock('@/lib/aegis/pivot-haiku', () => ({
  generateHaikuPivot: (...a: unknown[]) => mockGenerateHaikuPivot(...a),
}));

vi.mock('@/lib/data/rate-limiter', () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
  getCached: (...a: unknown[]) => mockGetCached(...a),
  setCache: (...a: unknown[]) => mockSetCache(...a),
}));

const { POST } = await import('./route');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const lowRelevanceActor: PivotEntityRow = {
  kind: 'threat_actor',
  data: {
    actor_id: 'MinorActor',
    display_name: 'MinorActor',
    aliases: null,
    attribution_country: null,
    last_active_at: null,
    composite_score: 40, // below 80 → no Haiku
    actor_grade: 'C',
    top_sector: 'Healthcare',
    peer_actor_display_name: 'PeerActor',
    campaign_count: 2,
    target_count: 3,
  },
};

const highRelevanceActor: PivotEntityRow = {
  kind: 'threat_actor',
  data: {
    actor_id: 'LockBit',
    display_name: 'LockBit',
    aliases: null,
    attribution_country: 'RU',
    last_active_at: '2025-05-20T00:00:00Z',
    composite_score: 92, // above 80 → fires Haiku
    actor_grade: 'A',
    top_sector: 'Finance',
    peer_actor_display_name: 'BlackCat',
    campaign_count: 14,
    target_count: 60,
  },
};

const haikuPivot: PivotSuggestion = {
  label: 'Map C2 overlap with peer actors',
  prefillPrompt: 'Map shared C2 infrastructure between LockBit and known peer actors.',
  contextNeeded: ['display_name'],
  rank: 0,
  source: 'haiku',
};

// ─── Setup ───────────────────────────────────────────────────────────────────

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/aegis/pivot-suggestions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockLoadEntityRow.mockReset();
  mockGenerateHaikuPivot.mockReset();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockReturnValue(true);
  mockGetCached.mockReset();
  mockGetCached.mockResolvedValue(null);
  mockSetCache.mockReset();
  mockSetCache.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/aegis/pivot-suggestions — validation', () => {
  it('returns 400 on missing kind', async () => {
    const res = await POST(postRequest({ entityId: 'LockBit' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on unsupported kind', async () => {
    const res = await POST(postRequest({ kind: 'matrix_cell', entityId: 'X' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing entityId', async () => {
    const res = await POST(postRequest({ kind: 'threat_actor' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on empty-string entityId', async () => {
    const res = await POST(postRequest({ kind: 'threat_actor', entityId: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on entityId exceeding 200 chars', async () => {
    const res = await POST(postRequest({ kind: 'threat_actor', entityId: 'x'.repeat(201) }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    const res = await POST(
      new Request('http://localhost/api/aegis/pivot-suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not valid json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/aegis/pivot-suggestions — happy paths', () => {
  it('returns templated pivots for a low-relevance threat actor (no Haiku)', async () => {
    mockLoadEntityRow.mockResolvedValueOnce(lowRelevanceActor);

    const res = await POST(postRequest({ kind: 'threat_actor', entityId: 'MinorActor' }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.suggestions.length).toBe(3);
    for (const s of json.suggestions) {
      expect(s.source).toBe('template');
    }
    expect(json.sourceUrl).toBe('/api/aegis/threat-actors/view?id=MinorActor');
    expect(mockGenerateHaikuPivot).not.toHaveBeenCalled();
  });

  it('appends Haiku pivot for a high-relevance threat actor + trims a template', async () => {
    mockLoadEntityRow.mockResolvedValueOnce(highRelevanceActor);
    mockGenerateHaikuPivot.mockResolvedValueOnce(haikuPivot);

    const res = await POST(postRequest({ kind: 'threat_actor', entityId: 'LockBit' }));
    const json = await res.json();

    expect(json.suggestions.length).toBe(3); // total still 3 (last template trimmed)
    const haikus = json.suggestions.filter((s: PivotSuggestion) => s.source === 'haiku');
    expect(haikus.length).toBe(1);
    expect(haikus[0]?.label).toBe('Map C2 overlap with peer actors');
    expect(mockGenerateHaikuPivot).toHaveBeenCalledTimes(1);
  });

  it('falls back to templates when rate-limit denies the Haiku call', async () => {
    mockLoadEntityRow.mockResolvedValueOnce(highRelevanceActor);
    mockCheckRateLimit.mockReturnValueOnce(false);

    const res = await POST(postRequest({ kind: 'threat_actor', entityId: 'LockBit' }));
    const json = await res.json();

    expect(json.suggestions.length).toBe(3);
    for (const s of json.suggestions) expect(s.source).toBe('template');
    expect(mockGenerateHaikuPivot).not.toHaveBeenCalled();
  });

  it('falls back to templates when Haiku itself returns null', async () => {
    mockLoadEntityRow.mockResolvedValueOnce(highRelevanceActor);
    mockGenerateHaikuPivot.mockResolvedValueOnce(null);

    const res = await POST(postRequest({ kind: 'threat_actor', entityId: 'LockBit' }));
    const json = await res.json();

    expect(json.suggestions.length).toBe(3);
    for (const s of json.suggestions) expect(s.source).toBe('template');
  });
});

describe('POST /api/aegis/pivot-suggestions — empty + cache + fail-soft', () => {
  it('returns empty suggestions when entity not found (cached 5min)', async () => {
    mockLoadEntityRow.mockResolvedValueOnce(null);

    const res = await POST(postRequest({ kind: 'cve', entityId: 'CVE-9999-9999' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.suggestions).toEqual([]);
    expect(json.sourceUrl).toBeNull();
    expect(mockSetCache).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 300);
  });

  it('short-circuits to the cached response on hit', async () => {
    mockGetCached.mockResolvedValueOnce({
      ok: true,
      sourceUrl: '/cached',
      suggestions: [],
      generatedAt: '2025-01-01T00:00:00Z',
    });

    const res = await POST(postRequest({ kind: 'threat_actor', entityId: 'LockBit' }));
    const json = await res.json();
    expect(json.sourceUrl).toBe('/cached');
    expect(mockLoadEntityRow).not.toHaveBeenCalled();
  });

  it('returns 200 with empty suggestions on internal DB failure (fail-soft)', async () => {
    mockLoadEntityRow.mockRejectedValueOnce(new Error('db down'));

    const res = await POST(postRequest({ kind: 'threat_actor', entityId: 'LockBit' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.suggestions).toEqual([]);
    expect(json.sourceUrl).toBe('/api/aegis/threat-actors/view?id=LockBit');
  });
});

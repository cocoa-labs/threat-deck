/**
 * Integration tests for the scorer orchestrator. Exercises the cache layer
 * (Redis + in-memory), the persistence layer (Postgres), and the keyword/
 * Haiku branching logic.
 *
 * Haiku is MOCKED via `vi.mock('./haiku')` — calling it for real in tests
 * would burn API budget and introduce flakes. The mock returns deterministic
 * results so we can assert exact branching behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from '@/lib/data/rate-limiter';
import { query } from '@/lib/db/client';

// Mock Haiku — every test that needs a stub configures `mockScoreWithHaiku`.
const mockScoreWithHaiku = vi.fn();
vi.mock('./haiku', () => ({
  scoreWithHaiku: (...args: unknown[]) => mockScoreWithHaiku(...args),
}));

// Imports below this point pick up the mock.
const { scoreItem } = await import('./scorer');

const TEST_URL_PREFIX = 'https://test.scorer.cocoa/';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_news_enrichments WHERE item_url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
  await clearCache('ai_relevance:');
}

beforeEach(() => {
  mockScoreWithHaiku.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('scoreItem — confident_yes path skips Haiku', () => {
  it('STRONG_TERM hit returns 0.9 + does not call Haiku', async () => {
    const r = await scoreItem({
      url: `${TEST_URL_PREFIX}strong-1`,
      title: 'WormGPT v2 lands on darknet markets',
    });
    expect(r.aiRelevance).toBe(0.9);
    expect(r.modelUsed).toBe('keywords');
    expect(r.evidence.decision).toBe('keyword_confident_yes');
    expect(mockScoreWithHaiku).not.toHaveBeenCalled();
  });

  it('persists the enrichment row', async () => {
    const url = `${TEST_URL_PREFIX}strong-2`;
    await scoreItem({ url, title: 'MITRE ATLAS adds new technique' });
    const { rows } = await query<{ ai_relevance: string; model_used: string }>(
      `SELECT ai_relevance, model_used FROM aegis_news_enrichments WHERE item_url = $1`,
      [url],
    );
    expect(rows[0]).toBeDefined();
    expect(Number(rows[0]!.ai_relevance)).toBe(0.9);
    expect(rows[0]!.model_used).toBe('keywords');
  });
});

describe('scoreItem — confident_no path skips Haiku', () => {
  it('negative-only signal returns 0.05 + does not call Haiku', async () => {
    const r = await scoreItem({
      url: `${TEST_URL_PREFIX}neg-1`,
      title: 'Tesla quarterly earnings beat expectations',
      summary: 'Stock price surged 8% in after-hours trading.',
    });
    expect(r.aiRelevance).toBe(0.05);
    expect(r.modelUsed).toBe('keywords');
    expect(r.evidence.decision).toBe('keyword_confident_no');
    expect(mockScoreWithHaiku).not.toHaveBeenCalled();
  });

  it('zero signal returns 0.20 + does not call Haiku', async () => {
    const r = await scoreItem({
      url: `${TEST_URL_PREFIX}neg-2`,
      title: 'New bakery opens downtown',
    });
    expect(r.aiRelevance).toBe(0.2);
    expect(r.modelUsed).toBe('keywords');
    expect(mockScoreWithHaiku).not.toHaveBeenCalled();
  });
});

describe('scoreItem — gray zone calls Haiku', () => {
  it('single-subcategory hit triggers Haiku, returns Haiku score when available', async () => {
    mockScoreWithHaiku.mockResolvedValueOnce({
      relevance: 0.82,
      category: 'vendor_incident',
      rationale: 'Article details a security disclosure at an AI-security firm.',
      rawJson: '{"relevance":0.82,"category":"vendor_incident","rationale":"…"}',
    });

    const r = await scoreItem({
      url: `${TEST_URL_PREFIX}gray-1`,
      title: 'Lakera announces new funding round',
    });

    expect(mockScoreWithHaiku).toHaveBeenCalledOnce();
    expect(r.aiRelevance).toBe(0.82);
    expect(r.modelUsed).toBe('haiku-4-5');
    expect(r.aiCategory).toBe('vendor_incident');
    expect(r.evidence.decision).toBe('haiku');
    expect(r.evidence.haiku?.rationale).toContain('AI-security firm');
  });

  it('Haiku returning null falls back to keyword score', async () => {
    mockScoreWithHaiku.mockResolvedValueOnce(null);

    // Title hits vendor_incident bank only (Lakera) — single-subcategory → gray.
    // No defensive/offensive/agentic_safety co-occurrence allowed or it would
    // promote to confident_yes and skip Haiku.
    const r = await scoreItem({
      url: `${TEST_URL_PREFIX}gray-2`,
      title: 'Lakera releases public benchmark dataset',
    });

    expect(mockScoreWithHaiku).toHaveBeenCalledOnce();
    expect(r.modelUsed).toBe('keywords');
    expect(r.evidence.decision).toBe('haiku_failed_fallback');
    // Keyword baseline for "Lakera" alone is gray (0.55)
    expect(r.aiRelevance).toBe(0.55);
  });
});

describe('scoreItem — cache hit short-circuits the whole pipeline', () => {
  it('second call returns the cached result without invoking Haiku again', async () => {
    mockScoreWithHaiku.mockResolvedValueOnce({
      relevance: 0.66,
      category: 'defensive',
      rationale: 'Test cache.',
      rawJson: '{}',
    });

    const url = `${TEST_URL_PREFIX}cache-1`;
    const first = await scoreItem({ url, title: 'Lakera adversarial test methodology' });
    expect(mockScoreWithHaiku).toHaveBeenCalledOnce();
    expect(first.fromCache).toBe(false);
    expect(first.aiRelevance).toBe(0.66);

    const second = await scoreItem({ url, title: 'Lakera adversarial test methodology' });
    // Haiku NOT called a second time
    expect(mockScoreWithHaiku).toHaveBeenCalledOnce();
    expect(second.fromCache).toBe(true);
    expect(second.aiRelevance).toBe(0.66);
    expect(second.evidence.decision).toBe('cache');
  });
});

describe('scoreItem — fail-soft contract', () => {
  it('Haiku throwing does not crash the orchestrator (returns null path)', async () => {
    // scorer.ts calls scoreWithHaiku which is designed to swallow internally.
    // Our mock simulates the case where someone returns null directly.
    mockScoreWithHaiku.mockResolvedValueOnce(null);
    const r = await scoreItem({
      url: `${TEST_URL_PREFIX}fail-1`,
      title: 'HiddenLayer announces new product',
    });
    expect(r).toBeDefined();
    expect(r.modelUsed).toBe('keywords');
  });
});

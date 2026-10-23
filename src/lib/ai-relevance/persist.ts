/**
 * AI-cyber relevance — durable enrichment persistence.
 *
 * Writes scorer results to `aegis_news_enrichments` so the score survives
 * Redis evictions and dev-server restarts. Redis (via getCached/setCache in
 * rate-limiter.ts) is the hot read path; this is the cold source of truth.
 *
 * Fail-soft contract: this module NEVER throws. DB failures degrade to
 * "result not persisted" but never disrupt the scoring pipeline — the
 * in-memory + Redis cache layers continue to function.
 */

import { query } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import type { AiCategory, AiRelevanceModel } from '@/lib/outbound/constants';

export interface EnrichmentRow {
  itemUrl: string;
  aiRelevance: number;
  aiCategory: AiCategory;
  modelUsed: AiRelevanceModel;
  scoredAt: string; // ISO8601
  evidenceJson: Record<string, unknown>;
}

/**
 * Upsert an enrichment row. ON CONFLICT updates every field so re-scoring an
 * item with a better model (e.g., keywords→haiku-4-5) overwrites cleanly.
 * Always returns; logs and swallows on any error.
 */
export async function upsertEnrichment(row: EnrichmentRow): Promise<void> {
  try {
    await query(
      `INSERT INTO aegis_news_enrichments
         (item_url, ai_relevance, ai_category, model_used, scored_at, evidence_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (item_url) DO UPDATE SET
         ai_relevance  = EXCLUDED.ai_relevance,
         ai_category   = EXCLUDED.ai_category,
         model_used    = EXCLUDED.model_used,
         scored_at     = EXCLUDED.scored_at,
         evidence_json = EXCLUDED.evidence_json`,
      [
        row.itemUrl,
        row.aiRelevance,
        row.aiCategory === 'unrelated' ? null : row.aiCategory, // SQL CHECK allows 'unrelated'; null is also fine and signals "scored but not categorized"
        row.modelUsed,
        row.scoredAt,
        JSON.stringify(row.evidenceJson),
      ],
    );
  } catch (err) {
    logger.warn('[ai-relevance] upsertEnrichment failed', {
      itemUrl: row.itemUrl,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read the most recent enrichment for an item URL. Returns null on cache miss,
 * DB error, or no row.
 */
export async function getEnrichment(itemUrl: string): Promise<EnrichmentRow | null> {
  try {
    const { rows } = await query<{
      item_url: string;
      ai_relevance: string; // pg NUMERIC → string
      ai_category: AiCategory | null;
      model_used: AiRelevanceModel | null;
      scored_at: Date;
      evidence_json: Record<string, unknown>;
    }>(
      `SELECT item_url, ai_relevance, ai_category, model_used, scored_at, evidence_json
         FROM aegis_news_enrichments
        WHERE item_url = $1`,
      [itemUrl],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      itemUrl: row.item_url,
      aiRelevance: Number(row.ai_relevance),
      aiCategory: row.ai_category ?? 'unrelated',
      modelUsed: row.model_used ?? 'keywords',
      scoredAt: row.scored_at instanceof Date ? row.scored_at.toISOString() : String(row.scored_at),
      evidenceJson: row.evidence_json ?? {},
    };
  } catch (err) {
    logger.warn('[ai-relevance] getEnrichment failed', {
      itemUrl,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

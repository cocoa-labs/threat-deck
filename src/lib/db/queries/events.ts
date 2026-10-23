import type { IntelligenceItem, IntelligenceSource, Severity } from '@/lib/types';
import { query, queryOne } from '../client';

export interface IntelligenceItemRow {
  id: string;
  source: IntelligenceSource;
  source_id: string | null;
  category: string | null;
  severity: Severity;
  title: string;
  summary: string | null;
  url: string | null;
  published_at: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_name: string | null;
  entities: string[];
  tags: string[];
  raw_data: unknown;
  created_at: string;
}

export async function insertIntelligenceItem(
  item: Omit<IntelligenceItem, 'id' | 'createdAt'>,
): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO intelligence_items
      (source, source_id, category, severity, title, summary, url,
       published_at, geo_lat, geo_lon, geo_name, entities, tags, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (source, source_id) DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       severity = EXCLUDED.severity,
       raw_data = EXCLUDED.raw_data
     RETURNING id`,
    [
      item.source,
      item.sourceId,
      item.category,
      item.severity,
      item.title,
      item.summary,
      item.url,
      item.publishedAt,
      item.geo?.lat,
      item.geo?.lon,
      item.geo?.name,
      item.entities,
      item.tags,
      item.rawData,
    ],
  );
  return result!.id;
}

export async function getRecentItems(params: {
  source?: IntelligenceSource;
  severity?: Severity;
  limit?: number;
  since?: string;
}): Promise<IntelligenceItemRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (params.source) {
    conditions.push(`source = $${paramIdx++}`);
    values.push(params.source);
  }
  if (params.severity) {
    conditions.push(`severity = $${paramIdx++}`);
    values.push(params.severity);
  }
  if (params.since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    values.push(params.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit ?? 50;

  const result = await query<IntelligenceItemRow>(
    `SELECT * FROM intelligence_items ${where} ORDER BY created_at DESC LIMIT $${paramIdx}`,
    [...values, limit],
  );
  return result.rows;
}

export async function searchItems(params: {
  query: string;
  sources?: IntelligenceSource[];
  since?: string;
  limit?: number;
}): Promise<IntelligenceItemRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  // Full text search on title and summary
  conditions.push(`(title ILIKE $${paramIdx} OR summary ILIKE $${paramIdx})`);
  values.push(`%${params.query}%`);
  paramIdx++;

  if (params.sources && params.sources.length > 0) {
    conditions.push(`source = ANY($${paramIdx++})`);
    values.push(params.sources);
  }
  if (params.since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    values.push(params.since);
  }

  const limit = params.limit ?? 20;
  const where = conditions.join(' AND ');

  const result = await query<IntelligenceItemRow>(
    `SELECT * FROM intelligence_items WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx}`,
    [...values, limit],
  );
  return result.rows;
}

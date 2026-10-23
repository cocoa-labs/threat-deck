import { v4 as uuid } from 'uuid';
import type {
  IntelligenceCategory,
  IntelligenceItem,
  IntelligenceSource,
  Severity,
} from '@/lib/types';

/**
 * Normalize raw data from any source into a unified IntelligenceItem.
 */
export function normalizeItem(params: {
  source: IntelligenceSource;
  sourceId?: string;
  title: string;
  summary?: string;
  url?: string;
  publishedAt?: string;
  geo?: { lat: number; lon: number; name?: string };
  entities?: string[];
  tags?: string[];
  rawData?: unknown;
  category?: IntelligenceCategory;
  severity?: Severity;
}): IntelligenceItem {
  return {
    id: uuid(),
    source: params.source,
    sourceId: params.sourceId,
    category: params.category ?? classifyCategory(params.title, params.tags),
    severity: params.severity ?? 'info',
    title: params.title,
    summary: params.summary,
    url: params.url,
    publishedAt: params.publishedAt ?? new Date().toISOString(),
    geo: params.geo,
    entities: params.entities ?? [],
    tags: params.tags ?? [],
    rawData: params.rawData,
    createdAt: new Date().toISOString(),
  };
}

function classifyCategory(title: string, tags?: string[]): IntelligenceCategory {
  const text = `${title} ${(tags ?? []).join(' ')}`.toLowerCase();

  if (/war|conflict|military|attack|strike|missile|drone/i.test(text)) return 'conflict';
  if (/fed|rate|gdp|inflation|cpi|unemployment|treasury|bond/i.test(text)) return 'economic';
  if (/ai|chip|semiconductor|quantum|cyber|tech/i.test(text)) return 'technology';
  if (/congress|legislation|bill|executive order|policy|sanction/i.test(text)) return 'policy';
  if (/nuclear|enrichment|weapons|proliferation/i.test(text)) return 'proliferation';
  if (/coup|protest|unrest|crisis|humanitarian/i.test(text)) return 'instability';
  if (/stock|market|earnings|ipo|crypto|bitcoin/i.test(text)) return 'market';
  if (/whale|prediction|contract|trade/i.test(text)) return 'alternative';
  return 'strategic';
}

/**
 * Classify severity based on keywords and source.
 */
export function classifySeverity(title: string, _source?: string): Severity {
  const text = title.toLowerCase();

  if (/breaking|critical|emergency|urgent|crisis|attack|war/i.test(text)) return 'critical';
  if (/major|significant|escalat|crash|plunge|surge/i.test(text)) return 'high';
  if (/notable|important|shift|change|announce/i.test(text)) return 'medium';
  if (/minor|routine|update|report/i.test(text)) return 'low';
  return 'info';
}

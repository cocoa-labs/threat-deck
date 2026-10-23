/**
 * VisualBrief extraction for IMG Button V2.
 *
 * This module is intentionally browser-safe: deterministic parsing only, no
 * provider SDK imports. Server-only LLM fallback lives in visual-brief-llm.ts.
 */

import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { isStyleTag, type StyleTag } from './style-registry';

export const VISUAL_BRIEF_SCHEMA_VERSION = 'visual-v2';

export type VisualBriefSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface VisualBriefMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface VisualBriefSection {
  label: string;
  body: string;
}

export interface VisualBriefSource {
  name: string;
  url: string;
  tier?: 'VERIFIED' | 'RECALLED' | 'ASSESSED';
}

export interface VisualBriefTable {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface VisualBriefTimelineItem {
  label: string;
  value: string;
}

export interface VisualBriefSourceContext {
  sourcePanel?: string;
  dataType?: string;
  trendData?: Record<string, unknown>;
  timestamp?: string;
  [key: string]: unknown;
}

export interface VisualBrief {
  schemaVersion: typeof VISUAL_BRIEF_SCHEMA_VERSION;
  title: string;
  bluf: string;
  severity: VisualBriefSeverity;
  entityKind?: string;
  entityId?: string;
  sourcePanel?: string;
  metrics: VisualBriefMetric[];
  sections: VisualBriefSection[];
  table?: VisualBriefTable;
  timeline: VisualBriefTimelineItem[];
  sources: VisualBriefSource[];
  themeHints: string[];
}

export interface BuildVisualBriefInput {
  messageContent: string;
  sourceContext?: VisualBriefSourceContext | null;
  entityKind?: string;
  entityId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  dataTiles?: Array<{ label: string; value: string }>;
  bluf?: string;
}

const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/g;
const URL_RE = /(https?:\/\/[^\s)]+|\/api\/[^\s)]+)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g;
const SOURCE_LINE_RE =
  /(?:Source:)?\s*\[(VERIFIED|RECALLED|ASSESSED)\]\s*\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/gi;
const SEVERITY_RE = /\b(CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/i;
const GENERIC_SECTION_LABELS = new Set([
  'sources',
  'source',
  'references',
  'appendix',
  'confidence',
]);
const BLUF_LABELS = new Set(['bluf', 'bottom line', 'summary', 'executive summary']);
const METRIC_LABELS = [
  'CVSS',
  'EPSS',
  'KEV',
  'CISA',
  'PATCH',
  'RECORDS',
  'LOSS',
  'AUC',
  'P\\(EXPLOIT\\/30D\\)',
  'PROBABILITY',
  'CONFIDENCE',
  'FORECAST',
];
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'what',
  'into',
  'about',
  'source',
  'verified',
  'confidence',
  'analysis',
  'today',
  'program',
  'report',
]);

export function buildVisualBriefSync(input: BuildVisualBriefInput): VisualBrief {
  const text = normalizeWhitespace(input.messageContent);
  const sourceContext = sanitizeSourceContext(input.sourceContext);
  const sectionsByHeading = extractHeadingSections(text);
  const sources = extractSources(text, sourceContext);
  const table = extractFirstMarkdownTable(text);
  const bluf = truncateClean(
    input.bluf ??
      extractBlufFromSections(sectionsByHeading) ??
      extractFirstMeaningfulParagraph(text) ??
      `Cocoa AI generated a structured intelligence brief from this ${AGENT_IDENTITY.name} response.`,
    260,
  );
  const entityIds = unique(text.match(CVE_RE) ?? []);
  const entityId = input.entityId ?? entityIds[0] ?? extractContextEntityId(sourceContext);
  const entityKind = input.entityKind ?? inferEntityKind(text, sourceContext, entityId);
  const severity = normalizeSeverity(input.severity ?? extractSeverity(text));
  const title = truncateClean(extractTitle(text, sourceContext, bluf, entityId), 92);
  const metrics = collectMetrics(text, input.dataTiles, sourceContext, table).slice(0, 6);
  const timeline = extractTimeline(text).slice(0, 5);
  const sections = collectSections(text, sectionsByHeading, bluf).slice(0, 5);
  const themeHints = extractThemeHints(`${title} ${bluf} ${text}`).slice(0, 10);

  return {
    schemaVersion: VISUAL_BRIEF_SCHEMA_VERSION,
    title,
    bluf,
    severity,
    entityKind,
    entityId,
    sourcePanel: sourceContext?.sourcePanel,
    metrics,
    sections,
    ...(table ? { table } : {}),
    timeline,
    sources,
    themeHints,
  };
}

export function isVisualBriefSparse(brief: VisualBrief): boolean {
  return brief.metrics.length < 2 || brief.sections.length < 2;
}

export function resolveVisualStyleTag(brief: VisualBrief, override?: StyleTag): StyleTag {
  if (isStyleTag(override)) return override;
  const kind = brief.entityKind?.toLowerCase() ?? '';
  const haystack = buildStyleHaystack(brief);

  if (
    kind.includes('threat_actor') ||
    hasAptReference(haystack) ||
    hasAny(haystack, ['threat actor'])
  ) {
    return 'identity_intrusion';
  }
  if (
    kind.includes('forecast') ||
    kind.includes('prediction') ||
    hasAny(haystack, [
      'forecast',
      'prediction',
      'probability',
      'market impact',
      'ticker',
      'treasury',
      'yield',
      'equity',
      'index',
    ])
  ) {
    return 'market_signal_board';
  }
  if (
    kind.includes('supply') ||
    kind.includes('package') ||
    kind.includes('botnet') ||
    hasAny(haystack, [
      'supply chain',
      'package registry',
      'dependency',
      'dependencies',
      'npm',
      'pypi',
      'open vsx',
      'visual studio marketplace',
      'github',
      'botnet',
      'worm',
      'self-propagating',
      'developer environment',
      'repository',
    ])
  ) {
    return 'supply_chain_map';
  }
  if (
    kind.includes('threat_actor') ||
    hasAny(haystack, [
      'midnight blizzard',
      'svr',
      'oauth',
      'identity',
      'account',
      'mailbox',
      'email',
      'microsoft 365',
      'entra',
      'azure ad',
      'token',
      'credential',
      'password',
      'session',
      'tenant',
      'phishing',
    ])
  ) {
    return 'identity_intrusion';
  }
  if (
    kind.includes('breach') ||
    kind.includes('incident') ||
    kind.includes('compromised') ||
    hasAny(haystack, [
      'breach',
      'records',
      'compromised',
      'exposure',
      'exposed',
      'leak',
      'leaked',
      'data theft',
      'customer data',
      'vendor exposure',
      'third-party',
    ])
  ) {
    return 'exposure_ledger';
  }
  if (
    kind.includes('research') ||
    kind.includes('policy') ||
    kind.includes('article') ||
    hasAny(haystack, [
      'shadow ai',
      'research',
      'survey',
      'study',
      'policy',
      'governance',
      'executive',
      'perception',
      'workers',
      'confidence gap',
      'the register',
    ])
  ) {
    return 'research_gap_card';
  }
  if (
    brief.severity === 'critical' ||
    kind.includes('kev') ||
    kind.includes('cve') ||
    hasAny(haystack, ['kev', 'cve-', 'exploit', 'cvss', 'epss', 'patch', 'ransomware'])
  ) {
    return 'kev_pressure';
  }
  return 'crt_terminal';
}

function buildStyleHaystack(brief: VisualBrief): string {
  return [
    brief.entityKind,
    brief.entityId,
    brief.sourcePanel,
    brief.title,
    brief.bluf,
    ...brief.themeHints,
    ...brief.metrics.flatMap((metric) => [metric.label, metric.value, metric.detail]),
    ...brief.sections.flatMap((section) => [section.label, section.body]),
    ...brief.sources.flatMap((source) => [source.name, source.url]),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function hasAptReference(value: string): boolean {
  return /\bapt[-\s]?\d{2,}\b/.test(value);
}

export function normalizeSourceContext(value: unknown): VisualBriefSourceContext | null {
  return sanitizeSourceContext(value);
}

function sanitizeSourceContext(value: unknown): VisualBriefSourceContext | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const out: VisualBriefSourceContext = {};
  if (typeof record.sourcePanel === 'string') out.sourcePanel = record.sourcePanel;
  if (typeof record.dataType === 'string') out.dataType = record.dataType;
  if (typeof record.timestamp === 'string') out.timestamp = record.timestamp;
  if (record.trendData && typeof record.trendData === 'object') {
    out.trendData = pruneRecord(record.trendData as Record<string, unknown>);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function pruneRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value == null) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value;
    }
  }
  return out;
}

function extractHeadingSections(text: string): Array<{ label: string; body: string }> {
  const lines = text.split('\n');
  const sections: Array<{ label: string; body: string }> = [];
  let current: { label: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      if (current) {
        sections.push({
          label: cleanMarkdown(current.label),
          body: cleanMarkdown(current.bodyLines.join('\n')),
        });
      }
      current = { label: heading[1] ?? '', bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }

  if (current) {
    sections.push({
      label: cleanMarkdown(current.label),
      body: cleanMarkdown(current.bodyLines.join('\n')),
    });
  }

  return sections.filter((section) => section.label && section.body);
}

function extractBlufFromSections(sections: Array<{ label: string; body: string }>): string | null {
  const match = sections.find((section) => BLUF_LABELS.has(section.label.toLowerCase()));
  if (!match) return null;
  return firstSentences(match.body, 2);
}

function extractFirstMeaningfulParagraph(text: string): string | null {
  const cleaned = stripTables(text)
    .split(/\n{2,}/)
    .map(cleanMarkdown)
    .find((p) => p.length > 40 && !p.toLowerCase().startsWith('sources:'));
  return cleaned ? firstSentences(cleaned, 2) : null;
}

function extractTitle(
  text: string,
  sourceContext: VisualBriefSourceContext | null,
  bluf: string,
  entityId?: string,
): string {
  const firstHeading = text
    .split('\n')
    .map((line) => line.match(/^#{1,3}\s+(.+)$/)?.[1])
    .find((heading) => {
      const normalized = heading ? cleanMarkdown(heading).toLowerCase() : '';
      return normalized && !BLUF_LABELS.has(normalized) && !GENERIC_SECTION_LABELS.has(normalized);
    });
  if (firstHeading) return cleanMarkdown(firstHeading);

  const trendData = sourceContext?.trendData;
  for (const key of ['title', 'name', 'headline', 'displayName', 'cveId', 'cve_id']) {
    const value = trendData?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  if (entityId) return `${entityId} Intelligence Brief`;
  return firstSentences(bluf, 1).replace(/[.。]$/, '');
}

function normalizeSeverity(value: string | undefined): VisualBriefSeverity {
  const lower = value?.toLowerCase();
  if (lower === 'critical' || lower === 'high' || lower === 'medium' || lower === 'low') {
    return lower;
  }
  return 'info';
}

function extractSeverity(text: string): string | undefined {
  return text.match(SEVERITY_RE)?.[1];
}

function inferEntityKind(
  text: string,
  sourceContext: VisualBriefSourceContext | null,
  entityId?: string,
): string | undefined {
  const panel = sourceContext?.sourcePanel?.toLowerCase() ?? '';
  const dataType = sourceContext?.dataType?.toLowerCase() ?? '';
  const lower = text.toLowerCase();
  if (panel.includes('forecast') || panel.includes('prediction') || lower.includes('forecast')) {
    return 'forecast';
  }
  if (panel.includes('kev') || dataType.includes('kev') || lower.includes('kev')) return 'kev';
  if (entityId?.startsWith('CVE-') || panel.includes('cve') || dataType.includes('cve')) {
    return lower.includes('critical') ? 'cve_critical' : 'cve';
  }
  if (
    panel.includes('threatactor') ||
    lower.includes('threat actor') ||
    /\bAPT[-\s]?\w+/i.test(text)
  ) {
    return 'threat_actor';
  }
  if (panel.includes('breach') || lower.includes('breach')) return 'breach';
  return sourceContext?.dataType;
}

function extractContextEntityId(
  sourceContext: VisualBriefSourceContext | null,
): string | undefined {
  const trendData = sourceContext?.trendData;
  if (!trendData) return undefined;
  for (const key of [
    'id',
    'cveId',
    'cve_id',
    'actorId',
    'actor_id',
    'displayName',
    'name',
    'symbol',
    'ticker',
  ]) {
    const value = trendData[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function collectMetrics(
  text: string,
  dataTiles: Array<{ label: string; value: string }> | undefined,
  sourceContext: VisualBriefSourceContext | null,
  table: VisualBriefTable | undefined,
): VisualBriefMetric[] {
  const metrics: VisualBriefMetric[] = [];
  const add = (label: string, value: string, detail?: string) => {
    const cleanLabel = truncateClean(cleanMarkdown(label), 24);
    const cleanValue = truncateClean(cleanMarkdown(value).replace(/[.,;:]+$/, ''), 32);
    if (!cleanLabel || !cleanValue) return;
    const key = `${cleanLabel.toLowerCase()}:${cleanValue.toLowerCase()}`;
    if (metrics.some((m) => `${m.label.toLowerCase()}:${m.value.toLowerCase()}` === key)) return;
    metrics.push({
      label: cleanLabel,
      value: cleanValue,
      ...(detail ? { detail: truncateClean(detail, 60) } : {}),
    });
  };

  dataTiles?.forEach((tile) => {
    add(tile.label, tile.value);
  });
  const trendData = sourceContext?.trendData;
  if (trendData) {
    for (const key of [
      'cvss',
      'epss',
      'severity',
      'vendor',
      'product',
      'records',
      'probability',
      'change',
      'price',
    ]) {
      const value = trendData[key];
      if (typeof value === 'string' || typeof value === 'number')
        add(formatLabel(key), String(value));
    }
  }

  for (const label of METRIC_LABELS) {
    const re = new RegExp(`\\b(${label})\\b\\s*[:=]?\\s*([#$]?[\\w.%-]+)`, 'i');
    const match = text.match(re);
    if (match?.[1] && match[2]) add(match[1].replace(/\\/g, ''), match[2]);
  }

  for (const match of text.matchAll(/\b(\d+(?:\.\d+)?%)\b/g)) {
    add('Rate', match[1] ?? '');
    if (metrics.length >= 6) break;
  }
  for (const match of text.matchAll(/\$[\d,.]+(?:\s?(?:M|B|K|million|billion))?/gi)) {
    add('Exposure', match[0]);
    if (metrics.length >= 6) break;
  }

  if (table) {
    for (const row of table.rows) {
      if (metrics.length >= 6) break;
      const [label, value, detail] = row;
      if (label && value && label.length <= 28) add(label, value, detail);
    }
  }

  return metrics;
}

function collectSections(
  text: string,
  headingSections: Array<{ label: string; body: string }>,
  bluf: string,
): VisualBriefSection[] {
  const sections = headingSections
    .filter((section) => {
      const lower = section.label.toLowerCase();
      return !BLUF_LABELS.has(lower) && !GENERIC_SECTION_LABELS.has(lower);
    })
    .map((section) => ({
      label: truncateClean(section.label, 34),
      body: truncateClean(firstSentences(section.body, 2), 240),
    }))
    .filter((section) => section.label && section.body);

  if (sections.length >= 2) return sections;

  const bullets = text
    .split('\n')
    .map((line) => line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line))
    .map((line) => truncateClean(line, 210))
    .filter((line) => line.length > 28);

  for (const [index, body] of bullets.entries()) {
    if (sections.length >= 5) break;
    sections.push({ label: index === 0 ? 'Key Finding' : `Signal ${index + 1}`, body });
  }

  if (sections.length === 0) {
    sections.push({ label: 'Situation', body: truncateClean(bluf, 220) });
  }

  return sections;
}

function extractFirstMarkdownTable(text: string): VisualBriefTable | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isTableRow(lines[i]) || !isTableRow(lines[i + 1])) continue;
    const headers = splitTableRow(lines[i] ?? '');
    const rows: string[][] = [];
    const startRow = isTableSeparator(lines[i + 1]) ? i + 2 : i + 1;
    for (let j = startRow; j < lines.length; j++) {
      if (!isTableRow(lines[j])) break;
      if (isTableSeparator(lines[j])) continue;
      rows.push(splitTableRow(lines[j] ?? '').slice(0, headers.length));
      if (rows.length >= 6) break;
    }
    if (headers.length >= 2 && rows.length > 0) {
      return {
        title: 'Data Table',
        headers: headers.slice(0, 4),
        rows: rows.map((row) => row.slice(0, 4)),
      };
    }
  }
  return undefined;
}

function extractTimeline(text: string): VisualBriefTimelineItem[] {
  const items: VisualBriefTimelineItem[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\b(?:May|June|July|August|September|October|November|December|January|February|March|April)\s+\d{1,2}(?:,\s+\d{4})?\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d+\s+(?:day|days|week|weeks|month|months)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      const context = sentenceAround(text, match.index ?? 0);
      items.push({ label: truncateClean(context, 80), value });
      if (items.length >= 5) return items;
    }
  }
  return items;
}

function extractSources(
  text: string,
  sourceContext: VisualBriefSourceContext | null,
): VisualBriefSource[] {
  const sources: VisualBriefSource[] = [];
  const add = (name: string, url: string, tier?: VisualBriefSource['tier']) => {
    const cleanUrl = url.replace(/[.,;]+$/, '');
    if (!isUrl(cleanUrl)) return;
    if (sources.some((source) => source.url === cleanUrl)) return;
    sources.push({
      name: truncateClean(cleanMarkdown(name), 44) || domainLabel(cleanUrl),
      url: cleanUrl,
      ...(tier ? { tier } : {}),
    });
  };

  for (const match of text.matchAll(SOURCE_LINE_RE)) {
    add(match[2] ?? '', match[3] ?? '', match[1]?.toUpperCase() as VisualBriefSource['tier']);
  }
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const name = match[1] ?? '';
    const url = match[2] ?? '';
    if (/source|cisa|nvd|mitre|verge|nasa|sec|vendor|kev|advisory/i.test(name + url)) {
      add(name, url);
    }
  }

  const trendData = sourceContext?.trendData;
  for (const key of ['url', 'sourceUrl', 'link', 'href']) {
    const value = trendData?.[key];
    if (typeof value === 'string') {
      const name =
        typeof trendData?.source === 'string'
          ? trendData.source
          : typeof trendData?.title === 'string'
            ? trendData.title
            : domainLabel(value);
      add(name, value, 'VERIFIED');
    }
  }

  if (sources.length === 0) {
    const url = text.match(URL_RE)?.[0];
    if (url) add(domainLabel(url), url);
  }

  return sources.slice(0, 5);
}

function extractThemeHints(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 12);
}

function stripTables(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isTableRow(line) && !isTableSeparator(line))
    .join('\n');
}

function cleanMarkdown(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\*\*\[([^\]]+)\]\*\*/g, '[$1]')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`>#]/g, ' ')
      .replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, ''),
  );
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function firstSentences(value: string, maxSentences: number): string {
  const cleaned = cleanMarkdown(value);
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned];
  return sentences.slice(0, maxSentences).join(' ').trim();
}

function truncateClean(value: string, max: number): string {
  const cleaned = normalizeWhitespace(value);
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim()}...`;
}

function isTableRow(line: string | undefined): boolean {
  return Boolean(line && /^\s*\|.+\|\s*$/.test(line));
}

function isTableSeparator(line: string | undefined): boolean {
  return Boolean(line && /^\s*\|[\s\-:|]+\|\s*$/.test(line));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cleanMarkdown(cell.trim()))
    .filter(Boolean);
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    0,
    text.lastIndexOf('.', index - 1) + 1,
    text.lastIndexOf('\n', index - 1) + 1,
  );
  const endCandidates = [text.indexOf('.', index + 1), text.indexOf('\n', index + 1)].filter(
    (n) => n > index,
  );
  const end =
    endCandidates.length > 0 ? Math.min(...endCandidates) : Math.min(text.length, index + 120);
  return cleanMarkdown(text.slice(start, end));
}

function formatLabel(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isUrl(value: string): boolean {
  return /^(https?:\/\/|\/)/.test(value);
}

function domainLabel(url: string): string {
  if (url.startsWith('/')) return 'Cocoa AI';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Source';
  }
}

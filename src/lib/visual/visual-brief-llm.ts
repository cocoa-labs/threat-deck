import { budgetedAIFetch } from '@/lib/security/budget';
/**
 * Server-only VisualBrief builder with bounded Haiku fallback.
 *
 * Deterministic parsing remains the trust layer. Haiku only fills structure
 * when a response is too prose-heavy to produce a dense infographic.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { extractJsonObject } from '@/lib/utils/tolerant-json';
import {
  type BuildVisualBriefInput,
  buildVisualBriefSync,
  isVisualBriefSparse,
  type VisualBrief,
  type VisualBriefMetric,
  type VisualBriefSection,
  type VisualBriefSource,
  type VisualBriefTimelineItem,
} from './visual-brief';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1200;
const TIMEOUT_MS = 8_000;

export interface BuildVisualBriefOptions {
  llmFallback?: boolean;
}

export async function buildVisualBrief(
  input: BuildVisualBriefInput,
  options: BuildVisualBriefOptions = {},
): Promise<VisualBrief> {
  const base = buildVisualBriefSync(input);
  const llmFallback = options.llmFallback ?? process.env.NODE_ENV !== 'test';
  if (!llmFallback || !isVisualBriefSparse(base) || !process.env.ANTHROPIC_API_KEY) {
    return base;
  }

  const enriched = await enrichBriefWithHaiku(input, base);
  return enriched ?? base;
}

async function enrichBriefWithHaiku(
  input: BuildVisualBriefInput,
  base: VisualBrief,
): Promise<VisualBrief | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const client = new Anthropic({ fetch: budgetedAIFetch, apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: `You distill ${AGENT_IDENTITY.name}'s Cocoa AI Threat Deck responses into structured infographic briefs. Return strict JSON only. Do not invent facts. Use only the provided response and source context.`,
        messages: [
          {
            role: 'user',
            content: buildFallbackPrompt(input, base),
          },
        ],
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const textBlock = response.content.find((block) => block.type === 'text');
    const parsed = parseFallbackJson(textBlock?.text ?? '');
    if (!parsed) return null;
    return mergeBrief(base, parsed);
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

function buildFallbackPrompt(input: BuildVisualBriefInput, base: VisualBrief): string {
  return `Convert this ${AGENT_IDENTITY.name} response into a dense vertical infographic brief.

Return JSON with this shape:
{
  "title": "short headline",
  "bluf": "one or two sentence bottom line",
  "metrics": [{"label":"...", "value":"...", "detail":"optional"}],
  "sections": [{"label":"...", "body":"1-2 sentence insight"}],
  "timeline": [{"label":"short event", "value":"date or window"}],
  "themeHints": ["visual", "keywords"],
  "entityKind": "optional kind",
  "entityId": "optional id"
}

Rules:
- No invented numbers, dates, sources, or entities.
- Keep metric labels <= 24 chars and values <= 32 chars.
- Produce 4-6 metrics when possible and 3-5 sections.
- Do not include markdown.

Current deterministic draft:
${JSON.stringify(base).slice(0, 4000)}

Source context:
${JSON.stringify(input.sourceContext ?? null).slice(0, 2000)}

${AGENT_IDENTITY.name} response:
${input.messageContent.slice(0, 9000)}`;
}

type FallbackJson = Partial<
  Pick<VisualBrief, 'title' | 'bluf' | 'entityKind' | 'entityId' | 'themeHints'>
> & {
  metrics?: VisualBriefMetric[];
  sections?: VisualBriefSection[];
  timeline?: VisualBriefTimelineItem[];
  sources?: VisualBriefSource[];
};

function parseFallbackJson(raw: string): FallbackJson | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const out: FallbackJson = {};

  if (typeof obj.title === 'string') out.title = obj.title;
  if (typeof obj.bluf === 'string') out.bluf = obj.bluf;
  if (typeof obj.entityKind === 'string') out.entityKind = obj.entityKind;
  if (typeof obj.entityId === 'string') out.entityId = obj.entityId;
  if (Array.isArray(obj.themeHints)) {
    out.themeHints = obj.themeHints.filter((v): v is string => typeof v === 'string').slice(0, 10);
  }
  out.metrics = parseObjectArray(obj.metrics, ['label', 'value'])
    .slice(0, 6)
    .map((m) => ({ label: m.label!, value: m.value!, ...(m.detail ? { detail: m.detail } : {}) }));
  out.sections = parseObjectArray(obj.sections, ['label', 'body'])
    .slice(0, 5)
    .map((s) => ({ label: s.label!, body: s.body! }));
  out.timeline = parseObjectArray(obj.timeline, ['label', 'value'])
    .slice(0, 5)
    .map((t) => ({ label: t.label!, value: t.value! }));
  out.sources = parseObjectArray(obj.sources, ['name', 'url'])
    .slice(0, 5)
    .map((s) => ({
      name: s.name!,
      url: s.url!,
      ...(s.tier ? { tier: s.tier as VisualBriefSource['tier'] } : {}),
    }));

  return out;
}

function parseObjectArray(value: unknown, required: string[]): Record<string, string>[] {
  if (!Array.isArray(value)) return [];
  const rows: Record<string, string>[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (!required.every((key) => typeof record[key] === 'string' && record[key])) continue;
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(record)) {
      if (typeof val === 'string' && val.trim()) out[key] = val.trim();
    }
    rows.push(out);
  }
  return rows;
}

function mergeBrief(base: VisualBrief, fallback: FallbackJson): VisualBrief {
  return {
    ...base,
    title: fallback.title?.trim() || base.title,
    bluf: fallback.bluf?.trim() || base.bluf,
    entityKind: fallback.entityKind?.trim() || base.entityKind,
    entityId: fallback.entityId?.trim() || base.entityId,
    metrics:
      fallback.metrics && fallback.metrics.length >= base.metrics.length
        ? fallback.metrics
        : base.metrics,
    sections:
      fallback.sections && fallback.sections.length >= base.sections.length
        ? fallback.sections
        : base.sections,
    timeline:
      fallback.timeline && fallback.timeline.length > base.timeline.length
        ? fallback.timeline
        : base.timeline,
    sources:
      fallback.sources && fallback.sources.length > base.sources.length
        ? fallback.sources
        : base.sources,
    themeHints:
      fallback.themeHints && fallback.themeHints.length > base.themeHints.length
        ? fallback.themeHints
        : base.themeHints,
  };
}

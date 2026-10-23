import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';
import { formatXPrimaryPostText, normalizeAgentMarkdownForX, splitSentences } from './formatting';
import { X_LONGFORM_MAX_LENGTH } from './length';

const CVE_ID_RE = /\bCVE-\d{4}-\d{4,7}\b/i;
const DEFAULT_PUBLIC_SOURCE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? `${process.env.NEXT_PUBLIC_SITE_URL}/feed/cyber-wire`
  : '';
const URL_RE = /https?:\/\/[^\s)]+/gi;
const MARKDOWN_URL_RE = /\[[^\]]+\]\((https?:\/\/[^)]+|\/[^)]+)\)/gi;
const INTERNAL_PATH_RE = /^\/(?:api\/)?aegis(?:\/|$)/i;
const PRIVATE_HOST_RE =
  /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})$/i;

const PRIORITY_URL_KEYS = [
  'sourceUrl',
  'advisoryUrl',
  'vendorUrl',
  'referenceUrl',
  'nvdSourceUrl',
  'cisaUrl',
  'url',
  'link',
  'href',
];

const PROCESS_PATTERNS = [
  /\bpulling\b/i,
  /\bnow pulling\b/i,
  /\bchecking\b/i,
  /\bfetching\b/i,
  /\brunning\b/i,
  /\bsearching\b/i,
  /\bquerying\b/i,
  /\bmode\s*\d+\b/i,
  /\bin parallel\b/i,
  /\btool\b/i,
  /\baegis\b.*\b(doesn't|does not|no specific|missing)\b/i,
  // Conversational lead-ins / filler that shouldn't reach a published post.
  /^let me\b/i,
  /^let'?s\b/i,
  /^here'?s (the|your|a|my|what)\b/i,
  /^i'?ll\b/i,
  /^i'?m (pulling|checking|fetching|running|going to|gonna|about to)\b/i,
  /^(now|so|okay|alright|sure|right|got it)[,:]?\s+(let|here|i)\b/i,
  /^(one|just a) (sec|second|moment)\b/i,
];

// A focused subset of process / conversational markers to drop from an
// LLM-authored post. Deliberately narrower than PROCESS_PATTERNS (no broad
// "checking" / "running" / "tool") because the LLM draft is already polished —
// we only excise clear internal chatter, never legitimate operator language.
const LLM_PROCESS_DROP_PATTERNS = [
  /^(now )?pulling\b/i,
  /\bin parallel\b/i,
  /\btool call\b/i,
  /\baegis\b.*\b(doesn't|does not|no specific|missing)\b/i,
  /^let me\b/i,
  /^let'?s\b/i,
  /^here'?s (the|your|a|my|what)\b/i,
  /^i'?ll\b/i,
];

export interface BuildXPublishPackageInput {
  messageContent: string;
  sourceContext?: VisualBriefSourceContext | null;
  fallbackSourceUrl?: string;
}

export interface XPublishPackage {
  primaryText: string;
  replyText: string;
  sourceUrl: string;
  sourceUrls: string[];
}

export function buildXPublishPackage(input: BuildXPublishPackageInput): XPublishPackage {
  const sourceUrls = resolvePublicTweetSourceUrls(
    input.sourceContext,
    input.messageContent,
    input.fallbackSourceUrl,
  );
  return {
    primaryText: formatXPrimaryPostText(buildPrimaryPost(input.messageContent)),
    replyText: buildDefaultReplyText(sourceUrls),
    sourceUrl: sourceUrls[0] ?? DEFAULT_PUBLIC_SOURCE_URL,
    sourceUrls,
  };
}

export function resolvePublicTweetSourceUrl(
  sourceContext?: VisualBriefSourceContext | null,
  messageContent = '',
  fallbackSourceUrl = DEFAULT_PUBLIC_SOURCE_URL,
): string {
  return (
    resolvePublicTweetSourceUrls(sourceContext, messageContent, fallbackSourceUrl)[0] ??
    DEFAULT_PUBLIC_SOURCE_URL
  );
}

export function resolvePublicTweetSourceUrls(
  sourceContext?: VisualBriefSourceContext | null,
  messageContent = '',
  fallbackSourceUrl = DEFAULT_PUBLIC_SOURCE_URL,
): string[] {
  const candidates: string[] = [];
  const trendData = asRecord(sourceContext?.trendData);

  if (trendData) {
    for (const key of PRIORITY_URL_KEYS) {
      const value = trendData[key];
      if (typeof value === 'string') candidates.push(value);
    }
    for (const value of Object.values(trendData)) {
      if (typeof value === 'string') candidates.push(...extractUrls(value));
    }
  }

  candidates.push(...extractUrls(messageContent));

  const publicUrls: string[] = [];
  for (const candidate of candidates) {
    const publicUrl = normalizePublicSourceUrl(candidate);
    if (publicUrl && !publicUrls.includes(publicUrl)) publicUrls.push(publicUrl);
  }

  const cveId =
    readString(trendData, ['cveId', 'cveID']) ??
    extractCveId(messageContent) ??
    extractCveId(candidates.join(' ')) ??
    extractCveId(fallbackSourceUrl);
  if (cveId) {
    const nvdUrl = `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}`;
    if (!publicUrls.includes(nvdUrl)) publicUrls.push(nvdUrl);
  }

  if (publicUrls.length === 0) {
    const fallback = normalizePublicSourceUrl(fallbackSourceUrl);
    if (fallback) publicUrls.push(fallback);
  }

  return publicUrls.slice(0, 3);
}

export function sanitizeAgentTextForPublicPost(content: string): string {
  const normalized = normalizeAgentMarkdownForX(content)
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return '';

  // Preserve paragraph structure: within each paragraph drop process/filler
  // sentences and rejoin the rest with spaces (not a blank line per sentence).
  // splitSentences masks decimals/abbreviations so numbers never fragment.
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const kept = splitSentences(paragraph.replace(/\n+/g, ' '))
        .filter((sentence) => !PROCESS_PATTERNS.some((pattern) => pattern.test(sentence)))
        .map((sentence) => sentence.replace(/\bMODE\s*\d+\b/gi, 'analyst-mode'));
      return kept.join(' ').trim();
    })
    .filter(Boolean);

  return fitLongform(paragraphs.join('\n\n').trim());
}

function buildPrimaryPost(messageContent: string): string {
  // Always build from Max's actual words — never a generic CVE/patch/breach
  // template. sourceContext still feeds source-URL resolution separately.
  const sanitized = sanitizeAgentTextForPublicPost(messageContent);
  if (sanitized) return sanitized;

  return "Fresh signal from Cocoa AI: useful, verified enough to review, and worth a human look before it becomes tomorrow's cleanup.";
}

/**
 * Scrub an LLM-authored public post so it can ship without discarding the whole
 * draft (the old all-or-nothing reject fell back to boilerplate). Neutralizes
 * the few tokens that must never appear publicly — `MODE N` -> `analyst-mode`,
 * strip `BREAKING` — and drops only clearly-internal process / conversational
 * sentences (`LLM_PROCESS_DROP_PATTERNS`). Deliberately narrower than
 * `sanitizeAgentTextForPublicPost`: the LLM output is already polished, so we
 * avoid over-dropping on broad words like "checking". Returns '' only if nothing
 * usable survives. Decimal/abbreviation-safe (uses `splitSentences`).
 */
export function scrubLlmPrimaryText(content: string): string {
  const cleaned = content
    .replace(/\bBREAKING\b[:\s—-]*/gi, '')
    .replace(/\bMODE\s*\d+\b/gi, 'analyst-mode');

  // Filter process / conversational sentences but PRESERVE the author's line and
  // paragraph structure (a numbered list stays a list, prose stays prose).
  const lines = cleaned.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    const kept = splitSentences(trimmed).filter(
      (sentence) => !LLM_PROCESS_DROP_PATTERNS.some((pattern) => pattern.test(sentence)),
    );
    return kept.join(' ');
  });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildDefaultReplyText(sourceUrls: string[]): string {
  const links = sourceUrls.slice(0, 3).join('\n');
  return fitLongform(`Source trail and visual brief for the operator desk.\n${links}`);
}

function normalizePublicSourceUrl(value: string): string | null {
  const trimmed = stripTrailingUrlPunctuation(value.trim());
  if (!trimmed || trimmed.startsWith('/') || INTERNAL_PATH_RE.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    if (PRIVATE_HOST_RE.test(url.hostname)) return null;
    if (INTERNAL_PATH_RE.test(url.pathname)) return null;
    if (url.pathname.startsWith('/api/aegis/')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractUrls(value: string): string[] {
  const urls: string[] = [];
  for (const match of value.matchAll(MARKDOWN_URL_RE)) {
    const url = match[1];
    if (url) urls.push(url);
  }
  for (const match of value.matchAll(URL_RE)) {
    const url = match[0];
    if (url) urls.push(url);
  }
  return urls;
}

export function fitLongform(value: string): string {
  const normalized = value
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= X_LONGFORM_MAX_LENGTH) return normalized;

  let candidate = normalized;
  while (`${candidate}...`.length > X_LONGFORM_MAX_LENGTH && candidate.length > 0) {
    const over = `${candidate}...`.length - X_LONGFORM_MAX_LENGTH;
    candidate = candidate.slice(0, Math.max(0, candidate.length - over - 1)).trimEnd();
  }

  const boundary = Math.max(
    candidate.lastIndexOf('.'),
    candidate.lastIndexOf(';'),
    candidate.lastIndexOf(' '),
  );
  if (boundary > 80 && `${candidate.slice(0, boundary)}...`.length <= X_LONGFORM_MAX_LENGTH) {
    candidate = candidate.slice(0, boundary);
  }
  return `${candidate.trimEnd()}...`;
}

function stripTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/g, '');
}

function extractCveId(value: string): string | null {
  const match = value.match(CVE_ID_RE);
  return match ? match[0].toUpperCase() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

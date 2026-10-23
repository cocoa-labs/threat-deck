import { X_LONGFORM_MAX_LENGTH } from './length';

const URL_RE = /https?:\/\/[^\s)]+/gi;
const MARKDOWN_URL_RE = /\[([^\]]+)\]\((?:https?:\/\/[^)]+|\/[^)]+)\)/g;
const SOURCE_HEADING_RE = /^(sources?|source trail|public sources?)\s*:?$/i;

// Format a long-form X post to MIRROR the author's own structure — clean up
// markdown/decimals and add gentle paragraph spacing, but never re-derive a
// hook/BLUF/numbered/operator-take skeleton. The text's shape (prose stays
// prose, an N-point list stays N points) is preserved verbatim.
export function formatXPrimaryPostText(content: string): string {
  const normalized = normalizeAgentMarkdownForX(content);
  if (!normalized) return '';
  return limitLongform(spreadStructuredText(normalized));
}

export function normalizeAgentMarkdownForX(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
    .replace(MARKDOWN_URL_RE, '$1')
    .replace(URL_RE, ' ')
    .replace(/\*\*\[([^\]]+)\]\*\*/g, '[$1]')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*_]{3,}$/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .split('\n')
    .map(normalizeLineForX)
    .filter((line) => line !== null)
    .join('\n')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLineForX(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
  if (cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) return null;
  if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
    return trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' / ');
  }
  // Repair run-on sentences (word.Word -> word. Word) without touching decimals
  // ($368.97), versions, or dotted acronyms (U.S.): the final replace only fires
  // when a lowercase letter immediately precedes the period (a real sentence end).
  return trimmed
    .replace(/^[-*]\s+/, '- ')
    .replace(/^>\s+/, '')
    .replace(/([a-z])([.!?])(?=[A-Z])/g, '$1$2 ');
}

function spreadStructuredText(value: string): string {
  return stripTrailingSourceBlock(value)
    .replace(/\n(?=\d{1,2}[.)]\s+)/g, '\n\n')
    .replace(/\n(?=(?:BLUF|Operator take|Takeaway|Bottom line)\s*:)/gi, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTrailingSourceBlock(value: string): string {
  const lines = value.split('\n');
  const sourceIndex = lines.findIndex((line) => SOURCE_HEADING_RE.test(line.trim()));
  if (sourceIndex >= 0) return lines.slice(0, sourceIndex).join('\n').trim();
  return value.trim();
}

// Periods that are NOT sentence boundaries: inside numbers ($368.97, -2.99%, 28.5M,
// v2.5, CVSS 9.8) or ending a common abbreviation (vs., U.S., e.g., Inc., No., Q1).
// Mask them with a sentinel before splitting on sentence boundaries, then restore —
// so decimals and abbreviations never present a fake boundary to the splitter.
const PERIOD_SENTINEL = String.fromCharCode(1);
const DECIMAL_PERIOD_RE = /(\d)\.(?=\d)/g;
const ABBREVIATION_PERIOD_RE =
  /\b(?:vs|avg|approx|est|etc|inc|corp|co|ltd|llc|dept|gov|fig|no|al|sr|jr|mr|mrs|ms|dr|prof|st|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|e\.g|i\.e|u\.s|u\.k|a\.m|p\.m|q[1-4])\.(?=\s)/gi;

function maskNonBoundaryPeriods(value: string): string {
  return value
    .replace(DECIMAL_PERIOD_RE, `$1${PERIOD_SENTINEL}`)
    .replace(ABBREVIATION_PERIOD_RE, (match) => match.replace(/\.$/, PERIOD_SENTINEL));
}

function restoreNonBoundaryPeriods(value: string): string {
  return value.split(PERIOD_SENTINEL).join('.');
}

export function splitSentences(value: string): string[] {
  return maskNonBoundaryPeriods(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => restoreNonBoundaryPeriods(sentence).trim())
    .filter(Boolean);
}

function limitLongform(value: string): string {
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
    candidate.lastIndexOf('\n\n'),
    candidate.lastIndexOf('.'),
    candidate.lastIndexOf(' '),
  );
  if (boundary > 80 && `${candidate.slice(0, boundary)}...`.length <= X_LONGFORM_MAX_LENGTH) {
    candidate = candidate.slice(0, boundary);
  }
  return `${candidate.trimEnd()}...`;
}

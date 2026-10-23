import { scoreByKeywords } from '@/lib/ai-relevance/keywords';
import type { NewsItem, Tweet } from '@/lib/types';

export interface TopPulseSourceStats {
  totalConsidered: number;
  totalIncluded: number;
  publisherIncluded: number;
  socialIncluded: number;
  bySource: Record<string, number>;
}

export interface TopPulseResult {
  items: NewsItem[];
  sourceStats: TopPulseSourceStats;
}

export interface BuildTopPulseItemsParams {
  cyberItems?: NewsItem[];
  aiItems?: NewsItem[];
  tweets?: Tweet[];
  limit?: number;
  socialCap?: number;
  now?: Date;
}

type PulseKind = 'publisher' | 'social';

interface PulseCandidate {
  item: NewsItem;
  kind: PulseKind;
  ageMs: number;
  groupPriority: number;
  sourcePriority: number;
}

const DEFAULT_LIMIT = 18;
const DEFAULT_SOCIAL_CAP = 6;
const LEAD_PUBLISHER_MS = 2 * 60 * 60 * 1000;
const FRESH_SOCIAL_MS = 6 * 60 * 60 * 1000;
const RECENT_AI_PUBLISHER_MS = 36 * 60 * 60 * 1000;
const CONTEXT_AI_CYBER_MS = 72 * 60 * 60 * 1000;

const TRUSTED_CYBER_SOURCES = new Set([
  'Krebs on Security',
  'BleepingComputer',
  'The Hacker News',
  'SecurityWeek',
  'The Register Security',
  'CyberScoop',
  'The Record',
  'SANS ISC',
  'Help Net Security',
]);

const AI_PUBLISHER_SOURCES = new Set([
  'AI News',
  'MarkTechPost',
  'OpenAI News',
  'Google AI Blog',
  'Google DeepMind',
]);

const AI_CYBER_CONTEXT_SOURCES = new Set([
  'OWASP Gen AI / LLM Top 10',
  'Protect AI Blog',
  'Promptfoo Blog',
  'MITRE ATLAS Data',
  'Embrace The Red',
  'Simon Willison',
  'AI Snake Oil',
  'AI Incident Database',
]);

const AI_BREAKING_RE =
  /\b(?:announc(?:e|ed|es|ing)|launch(?:ed|es|ing)?|release(?:d|s|ing)?|roll(?:ed|s)?\s+out|preview|introduc(?:e|ed|es|ing)|new\s+(?:model|agent|system|tool|benchmark|eval)|frontier\s+model|reasoning\s+model|multimodal|agentic|API|open[- ]weight|safety|alignment|red[- ]team|benchmark|eval|inference|training)\b/i;

const AI_SECURITY_RE =
  /\b(?:prompt\s+injection|jailbreak|guardrail|red[- ]team|sandbox|exfiltrat|model\s+(?:theft|leak|weight)|LLM\s+(?:firewall|gateway)|AI\s+security|AI\s+safety\s+incident|MCP\s+(?:server|tool|client|protocol)|agentic\s+(?:risk|incident|exploit|attack)|deepfake|voice\s+clone|AI[- ]powered\s+(?:phish|malware|attack|ransomware)|OWASP\s+LLM|MITRE\s+ATLAS)\b/i;

const CYBER_TWEET_RE =
  /\b(?:CVE-\d{4}-\d+|KEV|zero[- ]day|0day|exploit|vulnerab(?:le|ility)|ransomware|malware|breach|phish|threat actor|APT\d*|MITRE|ATT&CK|IOC\b|C2 server|RCE\b|LPE\b|patch|advisory|disclosure|backdoor|implant|TTP\b|infosec|cybersec)\b/i;

const AI_TWEET_RE =
  /\b(?:OpenAI|Anthropic|Claude|ChatGPT|GPT(?:-\d)?|Google\s+DeepMind|Gemini|Meta\s+AI|Llama|Mistral|xAI|Grok|frontier\s+model|reasoning|multimodal|agentic|model\s+(?:release|drop|pricing|capability|benchmark)|tokens?|API|eval|red[- ]team|safety|alignment|robotics)\b/i;

export function buildTopPulseItems(params: BuildTopPulseItemsParams): TopPulseResult {
  const limit = clampPositiveInt(params.limit, DEFAULT_LIMIT);
  const socialCap = clampPositiveInt(params.socialCap, DEFAULT_SOCIAL_CAP);
  const nowMs = params.now?.getTime() ?? Date.now();
  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();
  const publisherCandidates: PulseCandidate[] = [];
  const socialCandidates: PulseCandidate[] = [];
  const newsItems = [...(params.cyberItems ?? []), ...(params.aiItems ?? [])];

  for (const item of newsItems) {
    const decision = classifyNewsItem(item, nowMs);
    if (!decision) continue;

    const urls = collectNewsUrls(item);
    const titleKey = normalizeTitle(item.title);
    if (isDuplicate(titleKey, urls, seenTitles, seenUrls)) continue;

    rememberCandidate(titleKey, urls, seenTitles, seenUrls);
    publisherCandidates.push({
      item: normalizeNewsItemCategory(item, decision.category),
      kind: 'publisher',
      ageMs: ageMs(item.publishedAt, nowMs),
      groupPriority: groupPriority('publisher', ageMs(item.publishedAt, nowMs), decision.priority),
      sourcePriority: decision.priority,
    });
  }

  const includedSocialUrls = new Set(seenUrls);
  const includedSocialTitles = new Set(seenTitles);
  for (const tweet of params.tweets ?? []) {
    const decision = classifyTweet(tweet, nowMs);
    if (!decision) continue;

    const item = tweetToNewsItem(tweet);
    const urls = collectTweetUrls(tweet);
    urls.add(item.url);
    const titleKey = normalizeTitle(item.title);
    if (isDuplicate(titleKey, urls, includedSocialTitles, includedSocialUrls)) continue;

    rememberCandidate(titleKey, urls, includedSocialTitles, includedSocialUrls);
    socialCandidates.push({
      item,
      kind: 'social',
      ageMs: ageMs(item.publishedAt, nowMs),
      groupPriority: groupPriority('social', ageMs(item.publishedAt, nowMs), decision.priority),
      sourcePriority: decision.priority,
    });
  }

  socialCandidates.sort(compareCandidates);

  const candidates = [...publisherCandidates, ...socialCandidates.slice(0, socialCap)];
  candidates.sort(compareCandidates);

  const items = candidates.slice(0, limit).map((candidate) => candidate.item);
  return {
    items,
    sourceStats: buildSourceStats(
      params,
      items,
      items.filter((item) => item.category === 'social').length,
    ),
  };
}

function classifyNewsItem(
  item: NewsItem,
  nowMs: number,
): { priority: number; category: 'cyber' | 'ai' } | null {
  const source = item.source;
  const age = ageMs(item.publishedAt, nowMs);
  const haystack = `${item.title}\n${item.summary ?? ''}`;
  const keywordScore = scoreByKeywords({ title: item.title, summary: item.summary });
  const aiRelevant =
    (item.aiRelevance != null && item.aiRelevance >= 0.55 && item.aiCategory !== 'unrelated') ||
    keywordScore.band === 'confident_yes' ||
    keywordScore.band === 'gray';

  if (TRUSTED_CYBER_SOURCES.has(source)) {
    return { priority: 10, category: 'cyber' };
  }

  if (AI_PUBLISHER_SOURCES.has(source) && age <= RECENT_AI_PUBLISHER_MS) {
    if (AI_BREAKING_RE.test(haystack) || AI_SECURITY_RE.test(haystack) || aiRelevant) {
      return { priority: 20, category: 'ai' };
    }
  }

  if (AI_CYBER_CONTEXT_SOURCES.has(source) && age <= CONTEXT_AI_CYBER_MS) {
    if (AI_SECURITY_RE.test(haystack) || CYBER_TWEET_RE.test(haystack) || aiRelevant) {
      return { priority: 25, category: 'ai' };
    }
  }

  return null;
}

function classifyTweet(tweet: Tweet, nowMs: number): { priority: number } | null {
  const text = stripUrls(tweet.text);
  const age = ageMs(tweet.createdAt, nowMs);
  const keywordScore = scoreByKeywords({ title: text });
  const aiCyberRelevant = keywordScore.band === 'confident_yes' || keywordScore.band === 'gray';

  if (tweet.domain === 'infosec') {
    if (aiCyberRelevant) return { priority: 30 };
    if (tweet.relevant && CYBER_TWEET_RE.test(text)) return { priority: 32 };
    return null;
  }

  if (tweet.domain === 'ai') {
    if (age > RECENT_AI_PUBLISHER_MS) return null;
    if (aiCyberRelevant || AI_TWEET_RE.test(text) || AI_SECURITY_RE.test(text)) {
      return { priority: 35 };
    }
  }

  return null;
}

function normalizeNewsItemCategory(item: NewsItem, category: 'cyber' | 'ai'): NewsItem {
  if (item.category === category) return item;
  return { ...item, category };
}

function tweetToNewsItem(tweet: Tweet): NewsItem {
  return {
    id: `x-${tweet.id}`,
    title: stripUrls(tweet.text),
    summary: tweet.authorName,
    url: tweet.url,
    source: `@${tweet.authorUsername}`,
    category: 'social',
    publishedAt: tweet.createdAt,
  };
}

function compareCandidates(a: PulseCandidate, b: PulseCandidate): number {
  if (a.groupPriority !== b.groupPriority) return a.groupPriority - b.groupPriority;
  if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
  return new Date(b.item.publishedAt).getTime() - new Date(a.item.publishedAt).getTime();
}

function groupPriority(kind: PulseKind, age: number, sourcePriority: number): number {
  if (kind === 'publisher' && age <= LEAD_PUBLISHER_MS) return sourcePriority;
  if (kind === 'social' && age <= FRESH_SOCIAL_MS) return 30;
  if (kind === 'publisher') return 40 + sourcePriority / 100;
  return 50 + sourcePriority / 100;
}

function buildSourceStats(
  params: BuildTopPulseItemsParams,
  items: NewsItem[],
  socialIncluded: number,
): TopPulseSourceStats {
  const bySource: Record<string, number> = {};
  for (const item of items) {
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
  }

  return {
    totalConsidered:
      (params.cyberItems?.length ?? 0) +
      (params.aiItems?.length ?? 0) +
      (params.tweets?.length ?? 0),
    totalIncluded: items.length,
    publisherIncluded: items.length - socialIncluded,
    socialIncluded,
    bySource,
  };
}

function isDuplicate(
  titleKey: string,
  urls: Set<string>,
  seenTitles: Set<string>,
  seenUrls: Set<string>,
): boolean {
  if (titleKey && seenTitles.has(titleKey)) return true;
  for (const url of urls) {
    if (seenUrls.has(url)) return true;
  }
  return false;
}

function rememberCandidate(
  titleKey: string,
  urls: Set<string>,
  seenTitles: Set<string>,
  seenUrls: Set<string>,
): void {
  if (titleKey) seenTitles.add(titleKey);
  for (const url of urls) {
    seenUrls.add(url);
  }
}

function collectNewsUrls(item: NewsItem): Set<string> {
  const urls = new Set<string>();
  const normalized = normalizeUrl(item.url);
  if (normalized) urls.add(normalized);
  return urls;
}

function collectTweetUrls(tweet: Tweet): Set<string> {
  const urls = new Set<string>();
  const ownUrl = normalizeUrl(tweet.url);
  if (ownUrl) urls.add(ownUrl);

  for (const url of tweet.entities?.urls ?? []) {
    const expanded = normalizeUrl(url.expanded_url);
    if (expanded) urls.add(expanded);
  }

  return urls;
}

function normalizeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.trim().replace(/\/$/, '') || null;
  }
}

function normalizeTitle(title: string): string {
  return stripUrls(title)
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 180);
}

function stripUrls(value: string): string {
  return value
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ageMs(isoDate: string, nowMs: number): number {
  const time = new Date(isoDate).getTime();
  if (!Number.isFinite(time)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, nowMs - time);
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

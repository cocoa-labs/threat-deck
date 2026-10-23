import type { Tweet, TweetDomain } from '@/lib/types';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from '../rate-limiter';

const BEARER_TOKEN = () => process.env.TWITTER_BEARER_TOKEN;
const BASE_URL = 'https://api.x.com/2';

// ─── Curated Accounts (pre-resolved IDs to avoid extra API calls) ───

interface CuratedAccount {
  id: string;
  username: string;
  name: string;
  domain: TweetDomain;
}

export const CURATED_ACCOUNTS: CuratedAccount[] = [
  // ─── AI labs & frontier-model leaders ───
  // Real numeric IDs where known; `ai-…` placeholders resolve lazily via
  // /2/users/by (the search path uses `from:username` and works regardless).
  { id: 'ai-openai', username: 'OpenAI', name: 'OpenAI', domain: 'ai' },
  { id: '1605', username: 'sama', name: 'Sam Altman', domain: 'ai' },
  { id: 'ai-anthropic', username: 'AnthropicAI', name: 'Anthropic', domain: 'ai' },
  { id: 'ai-deepmind', username: 'GoogleDeepMind', name: 'Google DeepMind', domain: 'ai' },
  { id: 'ai-googleai', username: 'GoogleAI', name: 'Google AI', domain: 'ai' },
  { id: 'ai-metaai', username: 'AIatMeta', name: 'Meta AI', domain: 'ai' },
  { id: 'ai-mistral', username: 'MistralAI', name: 'Mistral AI', domain: 'ai' },
  { id: 'ai-xai', username: 'xai', name: 'xAI', domain: 'ai' },
  {
    id: '1573399256836309009',
    username: 'kimmonismus',
    name: 'Chubby (AI news)',
    domain: 'ai',
  },
  {
    id: '985281530070265862',
    username: 'dylan522p',
    name: 'Dylan Patel (SemiAnalysis)',
    domain: 'ai',
  },
  // Cybersecurity / Infosec — IDs are placeholders until resolved via /2/users/by/username
  // The search-based fetch path works on usernames regardless; per-user timeline calls need real IDs.
  { id: 'inf-briankrebs', username: 'briankrebs', name: 'Brian Krebs', domain: 'infosec' },
  {
    id: 'inf-thehackersnews',
    username: 'TheHackersNews',
    name: 'The Hacker News',
    domain: 'infosec',
  },
  {
    id: 'inf-malwrhunterteam',
    username: 'malwrhunterteam',
    name: 'MalwareHunterTeam',
    domain: 'infosec',
  },
  { id: 'inf-vxunderground', username: 'vxunderground', name: 'vx-underground', domain: 'infosec' },
  { id: 'inf-gossithedog', username: 'GossiTheDog', name: 'Kevin Beaumont', domain: 'infosec' },
  {
    id: 'inf-swiftonsecurity',
    username: 'SwiftOnSecurity',
    name: 'SwiftOnSecurity',
    domain: 'infosec',
  },
  {
    id: 'inf-thedfirreport',
    username: 'TheDFIRReport',
    name: 'The DFIR Report',
    domain: 'infosec',
  },
  { id: 'inf-cisagov', username: 'CISAgov', name: 'CISA', domain: 'infosec' },
  { id: 'inf-cyb3rops', username: 'cyb3rops', name: 'Florian Roth', domain: 'infosec' },
  { id: 'inf-mandiant', username: 'Mandiant', name: 'Mandiant', domain: 'infosec' },
  {
    id: 'inf-recordedfuture',
    username: 'Recorded_Future',
    name: 'Recorded Future',
    domain: 'infosec',
  },
  {
    id: 'inf-msftsecintel',
    username: 'MsftSecIntel',
    name: 'Microsoft Threat Intel',
    domain: 'infosec',
  },
  { id: 'inf-greynoiseio', username: 'GreyNoiseIO', name: 'GreyNoise', domain: 'infosec' },
  { id: 'inf-abusech', username: 'abuse_ch', name: 'abuse.ch', domain: 'infosec' },
  // ─── AI-cyber niche (Phase 9.3) ───
  // Top jailbreak / prompt-injection researchers + AI-security vendors.
  // Kept in the 'infosec' domain so existing panel filters and the relevance
  // regex below pick them up alongside the general-cyber baseline.
  {
    id: 'inf-elder_plinius',
    username: 'elder_plinius',
    name: 'Pliny the Prompter',
    domain: 'infosec',
  },
  { id: 'inf-liveoverflow', username: 'LiveOverflow', name: 'LiveOverflow', domain: 'infosec' },
  { id: 'inf-rez0', username: 'rez0__', name: 'Joseph Thacker', domain: 'infosec' },
  {
    id: 'inf-aisecurityhub',
    username: 'AISecurityHub',
    name: 'AI Security Hub',
    domain: 'infosec',
  },
  { id: 'inf-lakera', username: 'lakera_ai', name: 'Lakera', domain: 'infosec' },
  { id: 'inf-hiddenlayer', username: 'hiddenlayersec', name: 'HiddenLayer', domain: 'infosec' },
  { id: 'inf-protectai', username: 'protectai_', name: 'Protect AI', domain: 'infosec' },
];

// ─── Engagement Thresholds ───

const MIN_LIKES = 50;
const MIN_RETWEETS = 20;
const RECENCY_WINDOW_MS = 30 * 60_000; // 30 minutes — fresh tweets bypass engagement filter

// ─── Relevance Keywords (case-insensitive) ───

const DOMAIN_KEYWORDS: Record<TweetDomain, RegExp> = {
  markets:
    /\$[A-Z]{1,6}|earnings|Fed\b|rate cut|rate hike|inflation|GDP|yield|bond|equity|S&P|Nasdaq|NYSE|IPO|guidance|revenue|profit|margin|macro|PMI|CPI|PPI|jobs|payroll|recession/i,
  osint:
    /OSINT|conflict|military|strike|drone|missile|troops|sanctions|NATO|artillery|casualties|frontline|intelligence|defense|attack|ceasefire|convoy/i,
  policy:
    /Congress|Senate|House\b|bill\b|legislation|executive order|regulation|SEC\b|CFTC|DOJ|FTC|tariff|vote|debt ceiling|spending|appropriations|subpoena|hearing/i,
  crypto:
    /Bitcoin|BTC|ETH|Ethereum|DeFi|NFT|blockchain|on-chain|wallet|whale|exploit|hack|bridge|DEX|staking|yield|token|airdrop|SEC crypto|Binance|Coinbase/i,
  ai: /\bAI\b|artificial intelligence|GPT(?:-\d)?|Claude|Gemini|Llama|Mistral|frontier model|\bmodel\b|multimodal|reasoning|agentic|fine[- ]tun|benchmark|open[- ]weight|LLM|neural|training|inference|GPU|compute|chip|semiconductor|NVIDIA|datacenter|AGI|alignment|OpenAI|Anthropic|DeepMind|Meta AI|release|launch/i,
  // Extended in Phase 9.3 with AI-cyber terms so handles like @elder_plinius
  // and @rez0__ surface their prompt-injection / jailbreak / agentic-misuse
  // posts even when they don't include classical CVE/MITRE vocabulary.
  infosec:
    /CVE-\d{4}-\d+|\bCVSS\b|\bKEV\b|zero[- ]day|0day|exploit|vulnerab(?:le|ility)|ransomware|malware|breach|phish|threat actor|APT\d*|MITRE|ATT&CK|IOC\b|C2 server|RCE\b|LPE\b|patch Tuesday|advisory|disclosure|hacked|backdoor|implant|TTP\b|infosec|cybersec|prompt[- ]injection|jailbreak|guardrail|model[- ]theft|adversarial example|LLM[- ]attack|agentic[- ]misuse|WormGPT|FraudGPT|MITRE ATLAS|OWASP LLM/i,
};

function scoreTweetRelevance(tweet: Tweet): boolean {
  if (tweet.entities?.cashtags && tweet.entities.cashtags.length > 0) return true;
  const text = tweet.text;
  for (const re of Object.values(DOMAIN_KEYWORDS)) {
    if (re.test(text)) return true;
  }
  return false;
}

// ─── Search Filter Prefixes ───

const SEARCH_FILTERS: Record<string, string> = {
  markets: '($SPX OR $QQQ OR $VIX OR "Fed rate" OR earnings OR inflation OR "bond yield")',
  geopolitics: '(OSINT OR conflict OR sanctions OR NATO OR "national security" OR geopolitics)',
  policy: '(Congress OR Senate OR "executive order" OR regulation OR SEC OR tariff OR legislation)',
  crypto: '(Bitcoin OR $BTC OR $ETH OR DeFi OR "on-chain" OR blockchain OR crypto)',
  ai: '(AI OR "artificial intelligence" OR GPT OR LLM OR GPU OR compute OR OpenAI OR Anthropic)',
  infosec:
    '(CVE OR ransomware OR "zero-day" OR exploit OR vulnerability OR breach OR malware OR APT OR "threat actor" OR CISA OR MITRE)',
};

// ─── Tweet Fields ───

const TWEET_FIELDS = 'created_at,public_metrics,entities';
const USER_FIELDS = 'name,username,profile_image_url';
const EXPANSIONS = 'author_id';

// ─── Demo Data ───

const DEMO_TWEETS: Tweet[] = [
  {
    id: 'demo-1',
    text: 'We are rolling out our newest frontier model to API customers this week. Early evals show a step change on agentic coding and long-horizon reasoning.',
    authorId: 'ai-openai',
    authorName: 'OpenAI',
    authorUsername: 'OpenAI',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    likeCount: 18500,
    retweetCount: 9200,
    replyCount: 4300,
    quoteCount: 2800,
    url: 'https://x.com/OpenAI/status/demo-1',
    domain: 'ai',
    relevant: true,
  },
  {
    id: 'demo-2',
    text: 'New safety research: we red-teamed agentic tool use and found prompt-injection paths that survive standard guardrails. Mitigations and an eval harness in the post.',
    authorId: 'ai-anthropic',
    authorName: 'Anthropic',
    authorUsername: 'AnthropicAI',
    createdAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    likeCount: 9100,
    retweetCount: 3400,
    replyCount: 510,
    quoteCount: 620,
    url: 'https://x.com/AnthropicAI/status/demo-2',
    domain: 'ai',
    relevant: true,
  },
  {
    id: 'demo-3',
    text: 'CISA adds two actively exploited vulnerabilities to the KEV catalog. Federal agencies must patch by next Tuesday. CVE IDs and guidance below.',
    authorId: 'inf-cisagov',
    authorName: 'CISA',
    authorUsername: 'CISAgov',
    createdAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    likeCount: 5600,
    retweetCount: 4200,
    replyCount: 290,
    quoteCount: 470,
    url: 'https://x.com/CISAgov/status/demo-3',
    domain: 'infosec',
    relevant: true,
  },
  {
    id: 'demo-4',
    text: 'A new ransomware crew is weaponizing CVE-2026-41241 within 48h of the patch. PoC already circulating in the wild. Patch now and hunt for the IOCs below.',
    authorId: 'inf-briankrebs',
    authorName: 'Brian Krebs',
    authorUsername: 'briankrebs',
    createdAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    likeCount: 4300,
    retweetCount: 2800,
    replyCount: 670,
    quoteCount: 450,
    url: 'https://x.com/briankrebs/status/demo-4',
    domain: 'infosec',
    relevant: true,
  },
  {
    id: 'demo-5',
    text: 'jailbreak of the week: a single multilingual system-prompt override pops the new model safety layer in one turn. full thread with the payload below.',
    authorId: 'inf-elder_plinius',
    authorName: 'Pliny the Prompter',
    authorUsername: 'elder_plinius',
    createdAt: new Date(Date.now() - 32 * 60_000).toISOString(),
    likeCount: 7200,
    retweetCount: 5100,
    replyCount: 1100,
    quoteCount: 890,
    url: 'https://x.com/elder_plinius/status/demo-5',
    domain: 'infosec',
    relevant: true,
  },
  {
    id: 'demo-6',
    text: 'Introducing our latest Gemini update: stronger multimodal reasoning and a 2M-token context window, now rolling out in preview to developers.',
    authorId: 'ai-deepmind',
    authorName: 'Google DeepMind',
    authorUsername: 'GoogleDeepMind',
    createdAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    likeCount: 12200,
    retweetCount: 5100,
    replyCount: 920,
    quoteCount: 1300,
    url: 'https://x.com/GoogleDeepMind/status/demo-6',
    domain: 'ai',
    relevant: true,
  },
  {
    id: 'demo-7',
    text: 'Tracking a new info-stealer campaign abusing malicious VS Code extensions and npm packages to hit AI developers. IOCs and a YARA rule in the report.',
    authorId: 'inf-vxunderground',
    authorName: 'vx-underground',
    authorUsername: 'vxunderground',
    createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
    likeCount: 6800,
    retweetCount: 3100,
    replyCount: 340,
    quoteCount: 410,
    url: 'https://x.com/vxunderground/status/demo-7',
    domain: 'infosec',
    relevant: true,
  },
  {
    id: 'demo-8',
    text: 'Mass scanning for the new edge-device CVE jumped 40x in the last 6 hours from 1,200+ unique IPs. Expect broad exploitation imminently.',
    authorId: 'inf-greynoiseio',
    authorName: 'GreyNoise',
    authorUsername: 'GreyNoiseIO',
    createdAt: new Date(Date.now() - 72 * 60_000).toISOString(),
    likeCount: 3400,
    retweetCount: 2100,
    replyCount: 180,
    quoteCount: 260,
    url: 'https://x.com/GreyNoiseIO/status/demo-8',
    domain: 'infosec',
    relevant: true,
  },
];

// ─── Twitter v2 Response Types ───

interface TwitterV2Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  entities?: {
    hashtags?: { tag: string }[];
    cashtags?: { tag: string }[];
    urls?: { display_url: string; expanded_url: string }[];
    mentions?: { username: string }[];
  };
}

interface TwitterV2User {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

interface TwitterV2Response {
  data?: TwitterV2Tweet[];
  includes?: { users?: TwitterV2User[] };
  meta?: { result_count?: number; next_token?: string };
}

// ─── Normalize ───

function normalizeTweet(
  tweet: TwitterV2Tweet,
  users: Map<string, TwitterV2User>,
  domain?: TweetDomain,
): Tweet {
  const author = users.get(tweet.author_id ?? '');
  const normalized: Tweet = {
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id ?? '',
    authorName: author?.name ?? 'Unknown',
    authorUsername: author?.username ?? 'unknown',
    authorAvatarUrl: author?.profile_image_url,
    createdAt: tweet.created_at ?? new Date().toISOString(),
    likeCount: tweet.public_metrics?.like_count ?? 0,
    retweetCount: tweet.public_metrics?.retweet_count ?? 0,
    replyCount: tweet.public_metrics?.reply_count ?? 0,
    quoteCount: tweet.public_metrics?.quote_count ?? 0,
    url: `https://x.com/${author?.username ?? 'i'}/status/${tweet.id}`,
    domain,
    entities: {
      hashtags: tweet.entities?.hashtags?.map((h) => h.tag),
      cashtags: tweet.entities?.cashtags?.map((c) => c.tag),
      urls: tweet.entities?.urls?.map((u) => ({
        display_url: u.display_url,
        expanded_url: u.expanded_url,
      })),
      mentions: tweet.entities?.mentions?.map((m) => m.username),
    },
  };
  normalized.relevant = scoreTweetRelevance(normalized);
  return normalized;
}

// ─── Fetch Helpers ───

interface TwitterFetchResult {
  data: TwitterV2Response | null;
  status: number;
}

async function twitterFetch(path: string): Promise<TwitterFetchResult> {
  const token = BEARER_TOKEN();
  if (!token) return { data: null, status: 0 };

  const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    if (res.status === 429) {
      console.warn('[Twitter] Rate limited (429). Backing off for 15 minutes.');
      setBackoff('twitter', 15 * 60_000);
    } else {
      const body = await res.text().catch(() => '');
      console.warn(`[Twitter] API returned ${res.status}: ${body.slice(0, 200)}`);
    }
    return { data: null, status: res.status };
  }

  const json = (await res.json()) as TwitterV2Response;
  return { data: json, status: res.status };
}

// ─── Public API ───

// Build author_id → CuratedAccount lookup for domain assignment from search results
const ACCOUNT_BY_ID = new Map(CURATED_ACCOUNTS.map((a) => [a.id, a]));
const ACCOUNT_BY_USERNAME = new Map(CURATED_ACCOUNTS.map((a) => [a.username.toLowerCase(), a]));

// ─── Placeholder ID resolution (Phase 9.x bug fix) ───────────────────────────
// The original infosec accounts (+the 7 added in Phase 9.3) use placeholder
// IDs like 'inf-briankrebs' because their real Twitter numeric IDs were never
// looked up. The primary search path (`fetchTimelineViaSearch`) uses
// `from:${username}` and is unaffected. But the per-account fallback path
// (`fetchTimelinePerAccount`) hits `/2/users/{id}/tweets` and 400s on every
// placeholder ID — noisy logs + degraded fallback coverage.
//
// Fix: lazy-resolve placeholders via a single batch `/2/users/by?usernames=...`
// call, cache the placeholder→real-id mapping in memory, then the per-account
// fallback works correctly. Idempotent + fail-soft: one attempt per process,
// errors leave placeholders unresolved + the per-account loop skips them.

const RESOLVED_PLACEHOLDER_IDS = new Map<string, string>();
let placeholderResolutionAttempted = false;

function isPlaceholderId(id: string): boolean {
  return id.startsWith('inf-') || id.startsWith('ai-');
}

/** Returns the resolved real Twitter ID, or null if unresolved (skip the account). */
function resolveAccountId(id: string): string | null {
  if (!isPlaceholderId(id)) return id;
  return RESOLVED_PLACEHOLDER_IDS.get(id) ?? null;
}

interface TwitterByUsernameResponse {
  data?: Array<{ id: string; username: string; name?: string }>;
  errors?: Array<{ message: string; parameter?: string; value?: string }>;
}

async function resolvePlaceholderIds(): Promise<void> {
  if (placeholderResolutionAttempted) return;
  placeholderResolutionAttempted = true;

  const placeholders = CURATED_ACCOUNTS.filter((a) => isPlaceholderId(a.id));
  if (placeholders.length === 0) return;

  const token = BEARER_TOKEN();
  if (!token) return;

  // /2/users/by supports up to 100 usernames per call — our placeholders fit easily
  const usernames = placeholders.map((a) => a.username).join(',');
  const url = `${BASE_URL}/users/by?usernames=${encodeURIComponent(usernames)}&user.fields=id,username`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[Twitter] placeholder ID resolution returned ${res.status}: ${body.slice(0, 200)}`,
      );
      return;
    }
    const json = (await res.json()) as TwitterByUsernameResponse;
    if (!json.data) return;

    const byUsername = new Map(placeholders.map((p) => [p.username.toLowerCase(), p]));
    let resolved = 0;
    for (const user of json.data) {
      const placeholder = byUsername.get(user.username.toLowerCase());
      if (placeholder) {
        RESOLVED_PLACEHOLDER_IDS.set(placeholder.id, user.id);
        resolved++;
      }
    }
    if (resolved > 0) {
      console.log(`[Twitter] Resolved ${resolved}/${placeholders.length} placeholder account IDs`);
    }
  } catch (err) {
    console.warn(
      '[Twitter] placeholder ID resolution failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Apply engagement filter with time-based exemption.
 * Tweets < 30 min old always pass; older tweets need MIN_LIKES or MIN_RETWEETS.
 */
function filterByEngagement(tweets: Tweet[]): Tweet[] {
  const now = Date.now();
  const filtered = tweets.filter((t) => {
    const ageMs = now - new Date(t.createdAt).getTime();
    if (ageMs < RECENCY_WINDOW_MS) return true;
    return t.likeCount >= MIN_LIKES || t.retweetCount >= MIN_RETWEETS;
  });
  return filtered.length > 0 ? filtered : tweets;
}

// X API v2 /tweets/search/recent caps the `query` parameter at 512 chars.
// Keep headroom so the curated account list never overflows it (the old
// single-query builder concatenated all accounts and 400'd on every poll).
const SEARCH_QUERY_MAX_CHARS = 480;
const SEARCH_QUERY_SUFFIX = ' -is:reply -is:retweet';

/**
 * Split curated accounts into one-or-more
 * `(from:a OR from:b …) -is:reply -is:retweet` queries, each kept under the
 * X API 512-char limit. Typically 1–2 batches for the curated set.
 */
function buildSearchQueries(): string[] {
  const queries: string[] = [];
  let clauses: string[] = [];

  const flush = () => {
    if (clauses.length > 0) {
      queries.push(`(${clauses.join(' OR ')})${SEARCH_QUERY_SUFFIX}`);
      clauses = [];
    }
  };

  for (const account of CURATED_ACCOUNTS) {
    const clause = `from:${account.username}`;
    // Projected full-query length if we add this clause: parens (2) +
    // joined clauses + suffix.
    const projected = 2 + [...clauses, clause].join(' OR ').length + SEARCH_QUERY_SUFFIX.length;
    if (clauses.length > 0 && projected > SEARCH_QUERY_MAX_CHARS) flush();
    clauses.push(clause);
  }
  flush();

  return queries;
}

/**
 * Fetch recent tweets via /tweets/search/recent. Curated accounts are split
 * into length-safe batches (see buildSearchQueries) — typically 1–2 API calls.
 * Returns null only if every batch failed, so the per-account fallback runs.
 */
async function fetchTimelineViaSearch(): Promise<Tweet[] | null> {
  const queries = buildSearchQueries();
  const byId = new Map<string, Tweet>();
  let anySuccess = false;

  for (const query of queries) {
    const encodedQuery = encodeURIComponent(query);
    const path = `/tweets/search/recent?query=${encodedQuery}&max_results=30&tweet.fields=${TWEET_FIELDS}&expansions=${EXPANSIONS}&user.fields=${USER_FIELDS}`;
    const { data: response, status } = await twitterFetch(path);

    // 429 already set a 15-minute backoff in twitterFetch — stop hammering.
    if (status === 429) break;
    if (!response?.data) continue;
    anySuccess = true;

    const users = new Map<string, TwitterV2User>();
    for (const user of response.includes?.users ?? []) {
      users.set(user.id, user);
    }

    for (const t of response.data) {
      // Resolve domain from curated account list via author_id or username.
      const account = ACCOUNT_BY_ID.get(t.author_id ?? '');
      const user = users.get(t.author_id ?? '');
      const fallbackAccount = user
        ? ACCOUNT_BY_USERNAME.get(user.username.toLowerCase())
        : undefined;
      const domain = account?.domain ?? fallbackAccount?.domain;

      const tweet = normalizeTweet(t, users, domain);
      byId.set(tweet.id, tweet); // dedupe across batches
    }
  }

  if (!anySuccess) return null;
  return [...byId.values()];
}

/**
 * Fallback: fetch tweets per-account sequentially (original approach).
 * Used when the search endpoint fails.
 *
 * Awaits placeholder-ID resolution before iterating so accounts with
 * `inf-…` synthetic IDs can use their real Twitter numeric IDs. Accounts
 * that fail resolution are skipped silently — the primary search path
 * already covers them via `from:username` clauses.
 */
async function fetchTimelinePerAccount(): Promise<Tweet[]> {
  await resolvePlaceholderIds();
  const tweets: Tweet[] = [];

  for (const account of CURATED_ACCOUNTS) {
    const realId = resolveAccountId(account.id);
    if (!realId) {
      // Unresolved placeholder — skip rather than 400 the X API. The
      // primary search path picks up this account's tweets via username.
      continue;
    }

    const path = `/users/${realId}/tweets?max_results=5&tweet.fields=${TWEET_FIELDS}&expansions=${EXPANSIONS}&user.fields=${USER_FIELDS}`;
    const { data: response, status } = await twitterFetch(path);

    if (status === 429) break;
    if (!response?.data) continue;

    const users = new Map<string, TwitterV2User>();
    for (const user of response.includes?.users ?? []) {
      users.set(user.id, user);
    }
    // Ensure the curated account is represented in the users map keyed by
    // its real Twitter ID — so normalizeTweet's author lookups resolve
    // correctly even when the X API response's `includes.users` omits the
    // author (rare but observed).
    if (!users.has(realId)) {
      users.set(realId, {
        id: realId,
        name: account.name,
        username: account.username,
      });
    }

    for (const t of response.data) {
      tweets.push(normalizeTweet(t, users, account.domain));
    }
  }

  return tweets;
}

/**
 * Fetch recent tweets from curated accounts.
 * Primary: single search query (1 API call).
 * Fallback: per-account sequential fetching (15 API calls).
 */
export async function fetchTwitterTimeline(): Promise<Tweet[]> {
  const cacheKey = 'twitter:timeline';
  const cached = await getCached<Tweet[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('twitter')) return DEMO_TWEETS;

  if (!checkRateLimit('twitter')) {
    return DEMO_TWEETS;
  }

  const token = BEARER_TOKEN();
  if (!token) return DEMO_TWEETS;

  try {
    // Primary: single search query
    let tweets = await fetchTimelineViaSearch();

    // Fallback: per-account sequential if search returned nothing
    if (!tweets || tweets.length === 0) {
      tweets = await fetchTimelinePerAccount();
    }

    if (tweets.length === 0) return DEMO_TWEETS;

    // Filter with time-based exemption for fresh tweets
    const result = filterByEngagement(tweets);

    // Sort by newest first
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    await setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.warn(
      '[Twitter] Failed to fetch timeline:',
      error instanceof Error ? error.message : error,
    );
    return DEMO_TWEETS;
  }
}

/**
 * Search recent tweets with optional domain filter.
 */
export type TwitterSearchFilter =
  | 'markets'
  | 'geopolitics'
  | 'policy'
  | 'crypto'
  | 'ai'
  | 'infosec';

export async function fetchTwitterSearch(
  query: string,
  filter?: TwitterSearchFilter,
): Promise<Tweet[]> {
  const filterPrefix = filter ? SEARCH_FILTERS[filter] : undefined;
  const fullQuery = filterPrefix ? `${filterPrefix} ${query}` : query;
  const cacheKey = `twitter:search:${fullQuery}`;

  const cached = await getCached<Tweet[]>(cacheKey);
  if (cached) return cached;

  const demoFallback = DEMO_TWEETS.filter((t) =>
    t.text.toLowerCase().includes(query.toLowerCase()),
  );

  if (isBackedOff('twitter')) return demoFallback;

  if (!checkRateLimit('twitter')) {
    return demoFallback;
  }

  const token = BEARER_TOKEN();
  if (!token) {
    return demoFallback;
  }

  try {
    const encodedQuery = encodeURIComponent(fullQuery);
    const path = `/tweets/search/recent?query=${encodedQuery}&max_results=20&tweet.fields=${TWEET_FIELDS}&expansions=${EXPANSIONS}&user.fields=${USER_FIELDS}`;
    const { data: response } = await twitterFetch(path);

    if (!response?.data) return DEMO_TWEETS;

    const users = new Map<string, TwitterV2User>();
    for (const user of response.includes?.users ?? []) {
      users.set(user.id, user);
    }

    const tweets = response.data.map((t) => normalizeTweet(t, users));
    await setCache(cacheKey, tweets);
    return tweets;
  } catch (error) {
    console.warn('[Twitter] Failed to search:', error instanceof Error ? error.message : error);
    return DEMO_TWEETS;
  }
}

/**
 * Fetch replies to one of OUR posted threads (X detour). Searches the
 * conversation, excluding our own tweets. FAIL-SOFT by design: returns `[]` on a
 * missing token, backoff, rate-limit, non-200 (e.g. a tier-403 on recent
 * search), or any error — never throws, and never returns demo data (an empty
 * reply list must be trustworthy, unlike the timeline's demo fallback).
 */
export async function fetchRepliesForConversation(
  rootTweetId: string,
  maxResults = 20,
): Promise<Tweet[]> {
  if (!rootTweetId) return [];
  const handle = (process.env.TWITTER_OAUTH_HANDLE ?? '').replace(/^@/, '');
  const cacheKey = `twitter:replies:${rootTweetId}`;
  const cached = await getCached<Tweet[]>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('twitter') || !checkRateLimit('twitter')) return [];
  const token = BEARER_TOKEN();
  if (!token) return [];

  try {
    const clamped = Math.min(Math.max(maxResults, 10), 100);
    const q = encodeURIComponent(`conversation_id:${rootTweetId} -from:${handle} -is:retweet`);
    const path = `/tweets/search/recent?query=${q}&max_results=${clamped}&tweet.fields=${TWEET_FIELDS}&expansions=${EXPANSIONS}&user.fields=${USER_FIELDS}`;
    const { data: response, status } = await twitterFetch(path);
    if (status !== 200 || !response?.data) return [];

    const users = new Map<string, TwitterV2User>();
    for (const user of response.includes?.users ?? []) users.set(user.id, user);
    const replies = response.data.map((t) => normalizeTweet(t, users));
    await setCache(cacheKey, replies);
    return replies;
  } catch (err) {
    console.warn('[Twitter] reply fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

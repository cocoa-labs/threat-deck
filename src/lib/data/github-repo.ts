import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * GitHub repository client — GitHub REST API (repo metadata + README + tree).
 *
 * This is the fast-path that lets Max (`read_url`) read a pasted GitHub repo
 * URL even when the repo is too freshly-posted to be in any search index. The
 * original failing case: a user pasted a brand-new repo, FireCrawl's `/search`
 * returned `count: 0`, and Max improvised "empty on all crawl attempts." The
 * GitHub REST API returns live repo data regardless of index freshness, so the
 * `read_url` handler (WF3) tries this path first for github.com links.
 *
 * Resilience pattern mirrors src/lib/data/collectors/github-advisories.ts:
 *   cache → isBackedOff → checkRateLimit → safeFetch(no-store) → setCache → null on fail.
 *
 * Sources (public, no auth required; an optional GITHUB_TOKEN / GH_TOKEN raises
 * the 60/hr unauthenticated limit to 5000/hr):
 *   - GET https://api.github.com/repos/{owner}/{repo}
 *   - GET https://api.github.com/repos/{owner}/{repo}/readme
 *   - GET https://api.github.com/repos/{owner}/{repo}/contents   (optional tree)
 *
 * Unlike the collectors (which return `[]`), `fetchGithubRepo` returns `null`
 * on any failure (404 / 403 / 429 / non-ok / network). `null` is the explicit
 * signal to the caller: "fall back to a FireCrawl scrape." It NEVER throws.
 */

import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from './rate-limiter';

const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'cocoa-threat-deck/1.0';
const README_CAP = 8000;
const FILE_TREE_CAP = 50;
/** Flat fallback backoff when GitHub gives 403/429 without a parseable reset. */
const FLAT_BACKOFF_MS = 15 * 60_000;

// ─── GitHub REST API response shapes (fields we consume) ───

interface GithubLicense {
  spdx_id?: string | null;
}

interface GithubRepoResponse {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  // `subscribers_count` is the TRUE watcher count. `watchers_count` is a stars
  // alias on the v3 API and must NOT be used here.
  subscribers_count?: number;
  open_issues_count?: number;
  language?: string | null;
  topics?: string[] | null;
  license?: GithubLicense | null;
  pushed_at?: string | null;
  created_at?: string | null;
  default_branch?: string;
  archived?: boolean;
}

interface GithubReadmeResponse {
  content?: string;
  encoding?: string;
}

interface GithubContentEntry {
  name?: string;
  type?: string; // 'file' | 'dir' | 'symlink' | 'submodule'
}

// ─── Public types ───

export interface GithubFileTreeEntry {
  name: string;
  type: string;
}

export interface GithubRepoData {
  description: string | null;
  stars: number;
  forks: number;
  /** True watchers (`subscribers_count`), NOT the `watchers_count` stars alias. */
  watchers: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  license: string | null;
  pushedAt: string | null;
  createdAt: string | null;
  defaultBranch: string | null;
  archived: boolean;
  /** Decoded, capped README markdown — `null` when the repo has no README. */
  readme: string | null;
  /** Top-level entries — only populated when `includeFileTree` is requested. */
  fileTree?: GithubFileTreeEntry[];
  fullName: string;
  htmlUrl: string;
  /** Citation target — always equals `htmlUrl`. */
  sourceUrl: string;
}

export type GithubUrlKind = 'repo' | 'issue' | 'pull' | 'user' | 'gist' | 'other';

export interface ParsedGithubUrl {
  owner: string | null;
  repo: string | null;
  kind: GithubUrlKind;
}

// ─── Pure helpers (unit-testable in isolation) ───

/** First-segment paths that are GitHub product/meta routes, never `{owner}`. */
const RESERVED_FIRST_SEGMENTS = new Set([
  'orgs',
  'sponsors',
  'marketplace',
  'topics',
  'collections',
  'features',
  'about',
  'pricing',
  'settings',
  'notifications',
  'explore',
  'login',
  'join',
]);

/** GitHub repo sub-routes that still resolve to the repo (not `other`). */
const REPO_SUBROUTES = new Set(['tree', 'blob', 'commit', 'commits', 'releases', 'tags', 'wiki']);

/**
 * Classify a pasted GitHub URL into `{ owner, repo, kind }`. PURE — no I/O.
 *
 * - Junk / unparseable input → `{ null, null, 'other' }` (never throws).
 * - `gist.github.com/...` → `gist` (a different host; the repo API can't read it).
 * - Any non-`github.com` / `www.github.com` host → `other`.
 * - Robust to trailing slashes (empty path segments dropped).
 */
export function parseGithubUrl(url: string): ParsedGithubUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { owner: null, repo: null, kind: 'other' };
  }

  const host = parsed.hostname.toLowerCase();

  // Gist lives on its own host and isn't readable via the /repos API.
  if (host === 'gist.github.com') {
    return { owner: null, repo: null, kind: 'gist' };
  }
  if (host !== 'github.com' && host !== 'www.github.com') {
    return { owner: null, repo: null, kind: 'other' };
  }

  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);

  // Bare github.com → nothing to read.
  if (segments.length === 0) {
    return { owner: null, repo: null, kind: 'other' };
  }

  const first = segments[0] as string;
  if (RESERVED_FIRST_SEGMENTS.has(first.toLowerCase())) {
    return { owner: null, repo: null, kind: 'other' };
  }

  // Single segment → a user/org profile.
  if (segments.length === 1) {
    return { owner: first, repo: null, kind: 'user' };
  }

  // [owner, repo, ...] — strip a trailing `.git` from the repo name.
  const owner = first;
  const rawRepo = segments[1] as string;
  const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;

  if (segments.length === 2) {
    return { owner, repo, kind: 'repo' };
  }

  const third = (segments[2] as string).toLowerCase();
  if (third === 'issues') {
    return { owner, repo, kind: 'issue' };
  }
  if (third === 'pull' || third === 'pulls') {
    return { owner, repo, kind: 'pull' };
  }
  if (REPO_SUBROUTES.has(third)) {
    return { owner, repo, kind: 'repo' };
  }

  // Some other sub-route under the repo we don't special-case (e.g. /actions,
  // /projects, /security). It's still a repo URL, but not one we read via the
  // repo API path — treat as `other` so the caller falls back to a scrape.
  return { owner, repo, kind: 'other' };
}

/**
 * Decode a GitHub README payload to capped UTF-8 markdown. PURE — no I/O.
 *
 * The `/readme` endpoint returns base64 content. When `encoding === 'base64'`
 * we decode; any other encoding (or already-decoded raw text) is passed
 * through unchanged. The result is sliced to `cap` chars to bound token cost.
 */
export function decodeReadme(content: string, encoding: string, cap = README_CAP): string {
  let text: string;
  if (encoding === 'base64') {
    text = Buffer.from(content, 'base64').toString('utf-8');
  } else {
    text = content;
  }
  return text.slice(0, cap);
}

// ─── Internal fetch helpers ───

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Parse `x-ratelimit-reset` (epoch seconds) into a backoff duration in ms.
 * Falls back to a flat 15-minute window when the header is absent/unparseable
 * or already in the past.
 */
function backoffFromHeaders(res: Response): number {
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset) {
    const resetMs = Number.parseInt(reset, 10) * 1000;
    if (Number.isFinite(resetMs)) {
      const delta = resetMs - Date.now();
      if (delta > 0) return delta;
    }
  }
  return FLAT_BACKOFF_MS;
}

// ─── Public API ───

/**
 * Fetch live repo metadata + README (+ optional top-level file tree) for a
 * GitHub repository. Returns `null` on ANY failure — never throws.
 *
 * `null` means "the caller should fall back to a FireCrawl scrape" (the repo is
 * 404/private, GitHub rate-limited us, or the network failed). A present-but-
 * README-less repo still returns a `GithubRepoData` with `readme: null`.
 *
 * @param owner  repo owner / org (from `parseGithubUrl`)
 * @param repo   repo name (from `parseGithubUrl`, `.git` already stripped)
 * @param opts.includeFileTree  also fetch the capped top-level `/contents` list
 */
export async function fetchGithubRepo(
  owner: string,
  repo: string,
  opts?: { includeFileTree?: boolean },
): Promise<GithubRepoData | null> {
  const cacheKey = `github_repo:${owner}/${repo}:v1`;
  const cached = await getCached<GithubRepoData>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('github_repo')) return null;
  if (!checkRateLimit('github_repo')) return null;

  const headers = buildHeaders();
  const includeFileTree = opts?.includeFileTree === true;

  try {
    // Repo metadata + README fetched in parallel. The repo call is the gate:
    // a non-ok repo response means we can't return anything useful → null.
    const [repoRes, readmeRes] = await Promise.all([
      safeFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers, cache: 'no-store' }),
      safeFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`, { headers, cache: 'no-store' }),
    ]);

    // Rate-limit / abuse on the repo call → back off and bail to scrape.
    if (repoRes.status === 403 || repoRes.status === 429) {
      setBackoff('github_repo', backoffFromHeaders(repoRes));
      return null;
    }
    if (!repoRes.ok) {
      // 404 (missing/private) or any other non-ok → caller falls back to scrape.
      return null;
    }

    const repoJson = (await repoRes.json()) as GithubRepoResponse;

    // README is best-effort: a 404 (no README) still yields a valid repo.
    let readme: string | null = null;
    if (readmeRes.ok) {
      const readmeJson = (await readmeRes.json()) as GithubReadmeResponse;
      if (typeof readmeJson.content === 'string') {
        readme = decodeReadme(readmeJson.content, readmeJson.encoding ?? 'base64');
      }
    }

    // Optional top-level file tree (only when explicitly requested).
    let fileTree: GithubFileTreeEntry[] | undefined;
    if (includeFileTree) {
      try {
        const treeRes = await safeFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents`, {
          headers,
          cache: 'no-store',
        });
        if (treeRes.ok) {
          const treeJson = (await treeRes.json()) as GithubContentEntry[];
          if (Array.isArray(treeJson)) {
            fileTree = treeJson
              .filter((e): e is GithubContentEntry => typeof e?.name === 'string')
              .slice(0, FILE_TREE_CAP)
              .map((e) => ({ name: e.name as string, type: e.type ?? 'file' }));
          }
        }
      } catch {
        // File tree is optional — swallow and return the repo without it.
      }
    }

    const htmlUrl = repoJson.html_url ?? `https://github.com/${owner}/${repo}`;
    const data: GithubRepoData = {
      description: repoJson.description ?? null,
      stars: repoJson.stargazers_count ?? 0,
      forks: repoJson.forks_count ?? 0,
      watchers: repoJson.subscribers_count ?? 0,
      openIssues: repoJson.open_issues_count ?? 0,
      language: repoJson.language ?? null,
      topics: Array.isArray(repoJson.topics) ? repoJson.topics : [],
      license: repoJson.license?.spdx_id ?? null,
      pushedAt: repoJson.pushed_at ?? null,
      createdAt: repoJson.created_at ?? null,
      defaultBranch: repoJson.default_branch ?? null,
      archived: repoJson.archived === true,
      readme,
      ...(fileTree !== undefined ? { fileTree } : {}),
      fullName: repoJson.full_name ?? `${owner}/${repo}`,
      htmlUrl,
      sourceUrl: htmlUrl,
    };

    // Only cache a real success — never cache a null (no 6h fallback poison).
    await setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn('[github-repo] fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

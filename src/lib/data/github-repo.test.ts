/**
 * Tests for the GitHub repository client (read_url fast path).
 *
 * Three units under test:
 *   - parseGithubUrl  — PURE classifier (no I/O); junk must NOT throw.
 *   - decodeReadme    — PURE base64→utf-8 + cap; raw passthrough.
 *   - fetchGithubRepo — mirrors github-advisories: `fetch` is stubbed via
 *     `vi.stubGlobal` and branches on the URL substring (`/readme` vs
 *     `/contents` vs the repo root); the rate-limiter is `vi.doMock`-ed so the
 *     happy path skips Redis/the in-memory limiter. Every failure mode must
 *     return `null` (the "fall back to scrape" signal) and NEVER throw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Pure helpers — no module mocking needed (no I/O) ───

describe('parseGithubUrl', () => {
  it('classifies a bare owner/repo as repo', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/vercel/next.js')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      kind: 'repo',
    });
  });

  it('is robust to a trailing slash', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/vercel/next.js/')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      kind: 'repo',
    });
  });

  it('strips a trailing .git suffix from the repo name', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      kind: 'repo',
    });
  });

  it('treats a /tree/<branch>/<path> sub-route as repo', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/vercel/next.js/tree/canary/x')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      kind: 'repo',
    });
  });

  it('classifies an /issues/<n> URL as issue', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/vercel/next.js/issues/1')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      kind: 'issue',
    });
  });

  it('classifies a /pull/<n> URL as pull', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/vercel/next.js/pull/2')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      kind: 'pull',
    });
  });

  it('classifies a single-segment path as user', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/torvalds')).toEqual({
      owner: 'torvalds',
      repo: null,
      kind: 'user',
    });
  });

  it('classifies a gist.github.com host as gist', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://gist.github.com/u/abc')).toEqual({
      owner: null,
      repo: null,
      kind: 'gist',
    });
  });

  it('classifies a reserved first segment (/orgs/...) as other', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/orgs/vercel')).toEqual({
      owner: null,
      repo: null,
      kind: 'other',
    });
  });

  it('classifies /topics/<x> as other', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://github.com/topics/rust')).toEqual({
      owner: null,
      repo: null,
      kind: 'other',
    });
  });

  it('classifies a non-github host as other', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(parseGithubUrl('https://gitlab.com/vercel/next.js')).toEqual({
      owner: null,
      repo: null,
      kind: 'other',
    });
  });

  it('returns other for a junk string without throwing', async () => {
    const { parseGithubUrl } = await import('./github-repo');
    expect(() => parseGithubUrl('not a url at all')).not.toThrow();
    expect(parseGithubUrl('not a url at all')).toEqual({
      owner: null,
      repo: null,
      kind: 'other',
    });
  });
});

describe('decodeReadme', () => {
  it('decodes base64 to utf-8', async () => {
    const { decodeReadme } = await import('./github-repo');
    const b64 = Buffer.from('# Hello', 'utf-8').toString('base64');
    expect(decodeReadme(b64, 'base64')).toBe('# Hello');
  });

  it('caps decoded output to the requested length', async () => {
    const { decodeReadme } = await import('./github-repo');
    const long = 'y'.repeat(20_000);
    const b64 = Buffer.from(long, 'utf-8').toString('base64');
    expect(decodeReadme(b64, 'base64', 8000)).toHaveLength(8000);
  });

  it('passes already-decoded (non-base64) content through', async () => {
    const { decodeReadme } = await import('./github-repo');
    expect(decodeReadme('# Raw markdown', 'utf-8')).toBe('# Raw markdown');
  });
});

// ─── fetchGithubRepo — fetch stubbed + rate-limiter mocked ───

// Captured spies so individual tests can assert on setBackoff / checkRateLimit.
let setBackoffSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
let checkRateLimitImpl: () => boolean;

function mockRateLimiter(opts?: { rateLimited?: boolean }) {
  checkRateLimitImpl = () => !opts?.rateLimited;
  setBackoffSpy = vi.fn();
  vi.doMock('@/lib/data/rate-limiter', () => ({
    checkRateLimit: () => checkRateLimitImpl(),
    getCached: async () => null,
    setCache: async () => {},
    isBackedOff: () => false,
    setBackoff: (...args: unknown[]) => setBackoffSpy(...args),
  }));
}

const REPO_PAYLOAD = {
  full_name: 'octocat/hello-world',
  html_url: 'https://github.com/octocat/hello-world',
  description: 'My first repo',
  stargazers_count: 1234,
  forks_count: 56,
  subscribers_count: 78, // TRUE watchers — must map to `watchers`
  watchers_count: 1234, // stars alias — must be IGNORED
  open_issues_count: 9,
  language: 'TypeScript',
  topics: ['cli', 'security'],
  license: { spdx_id: 'MIT' },
  pushed_at: '2026-06-07T10:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
  default_branch: 'main',
  archived: false,
};

/**
 * Build a `fetch` stub that branches on URL substring. `readmeContent` is the
 * raw (pre-base64) README text; pass `null` to make the README endpoint 404.
 * `repoStatus` overrides the repo-root response status (default 200/ok).
 */
function stubFetch(opts: {
  readmeContent: string | null;
  repoStatus?: number;
  repoHeaders?: Record<string, string>;
}) {
  const { readmeContent, repoStatus = 200, repoHeaders = {} } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const headers = { get: (k: string) => repoHeaders[k.toLowerCase()] ?? null };
      if (url.includes('/readme')) {
        if (readmeContent === null) {
          return { ok: false, status: 404, headers, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          headers,
          json: async () => ({
            content: Buffer.from(readmeContent, 'utf-8').toString('base64'),
            encoding: 'base64',
          }),
        };
      }
      if (url.includes('/contents')) {
        return {
          ok: true,
          status: 200,
          headers,
          json: async () => [
            { name: 'README.md', type: 'file' },
            { name: 'src', type: 'dir' },
          ],
        };
      }
      // repo root
      return {
        ok: repoStatus >= 200 && repoStatus < 300,
        status: repoStatus,
        headers,
        json: async () => REPO_PAYLOAD,
      };
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('@/lib/data/rate-limiter');
  vi.unstubAllGlobals();
});

describe('fetchGithubRepo — happy path', () => {
  it('maps repo metadata + README from the two endpoints', async () => {
    mockRateLimiter();
    stubFetch({ readmeContent: '# Hello World' });

    const { fetchGithubRepo } = await import('./github-repo');
    const data = await fetchGithubRepo('octocat', 'hello-world');

    expect(data).not.toBeNull();
    expect(data?.stars).toBe(1234);
    expect(data?.forks).toBe(56);
    // watchers comes from subscribers_count (78), NOT watchers_count (1234).
    expect(data?.watchers).toBe(78);
    expect(data?.openIssues).toBe(9);
    expect(data?.language).toBe('TypeScript');
    expect(data?.topics).toEqual(['cli', 'security']);
    expect(data?.license).toBe('MIT');
    expect(data?.pushedAt).toBe('2026-06-07T10:00:00Z');
    expect(data?.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(data?.defaultBranch).toBe('main');
    expect(data?.archived).toBe(false);
    expect(data?.readme).toBe('# Hello World');
    expect(data?.fullName).toBe('octocat/hello-world');
    expect(data?.htmlUrl).toBe('https://github.com/octocat/hello-world');
    // sourceUrl is the citation target — always equals htmlUrl.
    expect(data?.sourceUrl).toBe('https://github.com/octocat/hello-world');
    // No file tree unless requested.
    expect(data?.fileTree).toBeUndefined();
  });

  it('includes a capped file tree when includeFileTree is set', async () => {
    mockRateLimiter();
    stubFetch({ readmeContent: '# Hi' });

    const { fetchGithubRepo } = await import('./github-repo');
    const data = await fetchGithubRepo('octocat', 'hello-world', { includeFileTree: true });

    expect(data?.fileTree).toEqual([
      { name: 'README.md', type: 'file' },
      { name: 'src', type: 'dir' },
    ]);
  });

  it('caps an over-long README to 8000 chars', async () => {
    mockRateLimiter();
    stubFetch({ readmeContent: 'z'.repeat(20_000) });

    const { fetchGithubRepo } = await import('./github-repo');
    const data = await fetchGithubRepo('octocat', 'hello-world');
    expect(data?.readme).toHaveLength(8000);
  });
});

describe('fetchGithubRepo — README missing but repo present', () => {
  it('returns the repo with readme:null when the README 404s', async () => {
    mockRateLimiter();
    stubFetch({ readmeContent: null }); // repo 200, readme 404

    const { fetchGithubRepo } = await import('./github-repo');
    const data = await fetchGithubRepo('octocat', 'hello-world');

    expect(data).not.toBeNull();
    expect(data?.readme).toBeNull();
    expect(data?.stars).toBe(1234); // repo fields still present
  });
});

describe('fetchGithubRepo — failure modes (null, never throw)', () => {
  it('returns null when the repo 404s', async () => {
    mockRateLimiter();
    stubFetch({ readmeContent: '# x', repoStatus: 404 });

    const { fetchGithubRepo } = await import('./github-repo');
    await expect(fetchGithubRepo('octocat', 'nope')).resolves.toBeNull();
  });

  it('returns null AND calls setBackoff when the repo 403s', async () => {
    mockRateLimiter();
    stubFetch({ readmeContent: '# x', repoStatus: 403 });

    const { fetchGithubRepo } = await import('./github-repo');
    const data = await fetchGithubRepo('octocat', 'rate-limited');

    expect(data).toBeNull();
    expect(setBackoffSpy).toHaveBeenCalledTimes(1);
    expect(setBackoffSpy.mock.calls[0]?.[0]).toBe('github_repo');
  });

  it('returns null when fetch rejects (network down)', async () => {
    mockRateLimiter();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const { fetchGithubRepo } = await import('./github-repo');
    await expect(fetchGithubRepo('octocat', 'hello-world')).resolves.toBeNull();
  });

  it('returns null with NO fetch when rate-limited', async () => {
    mockRateLimiter({ rateLimited: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { fetchGithubRepo } = await import('./github-repo');
    const data = await fetchGithubRepo('octocat', 'hello-world');

    expect(data).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

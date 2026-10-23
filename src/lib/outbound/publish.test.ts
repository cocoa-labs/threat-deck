/**
 * Integration tests for the channel-dispatching publisher. The Anthropic
 * SDK is NOT touched here — publish.ts only calls `postTweet`, which we
 * mock so we can assert the thread-chain semantics and the partial-publish
 * branch without burning X API budget.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

// Mock postTweet + the media uploaders BEFORE importing publish.ts so it
// picks up the mocks (deterministic — no network, no dry-run env dependence).
const mockPostTweet = vi.fn();
const mockUploadImage = vi.fn();
const mockUploadVideo = vi.fn();
vi.mock('@/lib/twitter/write-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/twitter/write-client')>(
    '@/lib/twitter/write-client',
  );
  return {
    ...actual,
    postTweet: (...args: unknown[]) => mockPostTweet(...args),
    uploadTweetImageFromUrl: (...args: unknown[]) => mockUploadImage(...args),
  };
});
vi.mock('@/lib/twitter/video-upload', () => ({
  uploadTweetVideoFromUrl: (...args: unknown[]) => mockUploadVideo(...args),
}));

// Audit is fire-and-forget; mock so we don't depend on a live audit pipeline.
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return { ...actual, recordAudit: vi.fn(async () => {}) };
});

const { publishDraft } = await import('./publish');

const TEST_MARKER = 'test:publish-9.1';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
  await query(
    `DELETE FROM aegis_outbound_log WHERE entity_kind = 'draft' AND entity_id LIKE 'test-pub-%'`,
  );
  await query(`DELETE FROM aegis_generated_media WHERE style_tag = 'test-pub-media'`);
}

async function seedApproved(payload: object, opts?: { id?: string }): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_outbound_drafts
       (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
     VALUES ('twitter', 'breaking', 'anchor', $1, $2::jsonb, 'approved', $3)
     RETURNING id`,
    [opts?.id ?? 'pub-test', JSON.stringify(payload), TEST_MARKER],
  );
  return Number(rows[0]!.id);
}

beforeEach(() => {
  mockPostTweet.mockReset();
  mockUploadImage.mockReset();
  mockUploadVideo.mockReset();
  return cleanup();
});
afterEach(cleanup);

async function seedMedia(opts: { status: string; kind?: 'image' | 'video' }): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_generated_media
       (media_kind, style_tag, provider, model_version, status, blob_url, owner_email)
     VALUES ($1, 'test-pub-media', 'test', 'test', $2, 'https://store.private.blob.vercel-storage.com/asset.png', $3)
     RETURNING id`,
    [opts.kind ?? 'image', opts.status, TEST_MARKER],
  );
  return Number(rows[0]!.id);
}

describe('publishDraft — Twitter happy path', () => {
  it('chains tweets sequentially with replyToTweetId threading', async () => {
    mockPostTweet
      .mockResolvedValueOnce({ ok: true, tweetId: 'real-1', dryRun: true })
      .mockResolvedValueOnce({ ok: true, tweetId: 'real-2', dryRun: true })
      .mockResolvedValueOnce({ ok: true, tweetId: 'real-3', dryRun: true });

    const id = await seedApproved({
      tweets: [
        { text: 'masthead #AICyber' },
        { text: 'story 1' },
        { text: 'cta 🧵 3/3', link: 'https://example.com' },
      ],
      canonicalHashtag: '#AICyber',
    });

    const r = await publishDraft(id, { dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tweetIds).toEqual(['real-1', 'real-2', 'real-3']);
    expect(r.outboundLogId).toBeGreaterThan(0);

    // Each call after the first should have been threaded via replyToTweetId
    expect(mockPostTweet).toHaveBeenCalledTimes(3);
    expect(mockPostTweet.mock.calls[0]![0]).toMatchObject({ replyToTweetId: undefined });
    expect(mockPostTweet.mock.calls[1]![0]).toMatchObject({ replyToTweetId: 'real-1' });
    expect(mockPostTweet.mock.calls[2]![0]).toMatchObject({ replyToTweetId: 'real-2' });

    // The third tweet had a link — composeTweetText appends it.
    expect(mockPostTweet.mock.calls[2]![0].text).toContain('https://example.com');

    // DB state: draft flipped to published, outbound_log written.
    const { rows } = await query<{ status: string; outbound_log_id: number | null }>(
      `SELECT status, outbound_log_id FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('published');
    expect(rows[0]!.outbound_log_id).not.toBeNull();
  });
});

describe('publishDraft — partial publish', () => {
  it('returns partial_publish when a tweet mid-chain fails', async () => {
    mockPostTweet
      .mockResolvedValueOnce({ ok: true, tweetId: 'real-1', dryRun: true })
      .mockResolvedValueOnce({ ok: false, error: 'network_error', detail: 'timeout' });

    const id = await seedApproved({
      tweets: [{ text: 'masthead #AICyber' }, { text: 'story 1' }, { text: 'cta 🧵 3/3' }],
      canonicalHashtag: '#AICyber',
    });

    const r = await publishDraft(id, { dryRun: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('partial_publish');
    expect(r.publishedCount).toBe(1);
    expect(r.tweetIds).toEqual(['real-1']);

    // Draft stays 'approved' (not 'published') so a human can retry.
    const { rows } = await query<{ status: string }>(
      `SELECT status FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('approved');

    // postTweet called twice (third never reached because we aborted).
    expect(mockPostTweet).toHaveBeenCalledTimes(2);
  });
});

describe('publishDraft — media on the last tweet', () => {
  it('uploads media and attaches it to ONLY the final tweet', async () => {
    mockPostTweet
      .mockResolvedValueOnce({ ok: true, tweetId: 'm-1', dryRun: true })
      .mockResolvedValueOnce({ ok: true, tweetId: 'm-2', dryRun: true })
      .mockResolvedValueOnce({ ok: true, tweetId: 'm-3', dryRun: true });
    mockUploadImage.mockResolvedValueOnce({ ok: true, mediaId: 'x-media-99' });

    const mediaId = await seedMedia({ status: 'ready', kind: 'image' });
    const id = await seedApproved({
      tweets: [
        { text: 'masthead #AICyber' },
        { text: 'story' },
        { text: 'coda + sources 🧵 3/3', link: 'https://example.com' },
      ],
      canonicalHashtag: '#AICyber',
      mediaId: String(mediaId),
      mediaKind: 'image',
    });

    const r = await publishDraft(id, { dryRun: true });
    expect(r.ok).toBe(true);
    expect(mockUploadImage).toHaveBeenCalledTimes(1);
    expect(mockPostTweet).toHaveBeenCalledTimes(3);
    // tweets 1 & 2 carry no media; only the final tweet carries the upload.
    expect(mockPostTweet.mock.calls[0]![0].mediaIds).toBeUndefined();
    expect(mockPostTweet.mock.calls[1]![0].mediaIds).toBeUndefined();
    expect(mockPostTweet.mock.calls[2]![0].mediaIds).toEqual(['x-media-99']);
  });

  it('fails before posting any tweet when the media is not ready', async () => {
    const mediaId = await seedMedia({ status: 'pending' });
    const id = await seedApproved({
      tweets: [{ text: 'masthead #AICyber' }, { text: 'coda 🧵 2/2' }],
      canonicalHashtag: '#AICyber',
      mediaId: String(mediaId),
      mediaKind: 'image',
    });

    const r = await publishDraft(id, { dryRun: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('media_upload_failed');
    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(mockPostTweet).not.toHaveBeenCalled();

    // Draft stays approved so the human can fix + retry.
    const { rows } = await query<{ status: string }>(
      `SELECT status FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('approved');
  });
});

describe('publishDraft — auth failure (reconnect, not partial)', () => {
  it('returns no_token when posting fails auth — nothing posted, draft stays re-approvable', async () => {
    mockPostTweet.mockResolvedValueOnce({ ok: false, error: 'no_token', detail: 'connect first' });
    const id = await seedApproved({
      tweets: [{ text: 'masthead #AICyber' }, { text: 'coda 🧵 2/2' }],
      canonicalHashtag: '#AICyber',
    });

    const r = await publishDraft(id, { dryRun: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Distinct from partial_publish so the UI can prompt "Reconnect X".
    expect(r.reason).toBe('no_token');
    expect(r.publishedCount ?? 0).toBe(0);

    const { rows } = await query<{ status: string }>(
      `SELECT status FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('approved');
  });

  it('treats a 401 twitter_api_error as a reconnect (no_token), not a partial publish', async () => {
    // X rejected the token (dead grant) — distinct from a true partial publish.
    // Retrying won't help until reconnected, so surface no_token.
    mockPostTweet.mockResolvedValueOnce({
      ok: false,
      error: 'twitter_api_error',
      detail: 'Unauthorized',
      status: 401,
    });
    const id = await seedApproved({
      tweets: [{ text: 'masthead #AICyber' }, { text: 'coda 🧵 2/2' }],
      canonicalHashtag: '#AICyber',
    });

    const r = await publishDraft(id, { dryRun: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_token');
    expect(r.publishedCount ?? 0).toBe(0);

    const { rows } = await query<{ status: string }>(
      `SELECT status FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('approved');
  });
});

describe('publishDraft — guards', () => {
  it('returns not_found for unknown id', async () => {
    const r = await publishDraft(999_999_999);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_found');
    expect(mockPostTweet).not.toHaveBeenCalled();
  });

  it('returns not_approved for a drafted (un-approved) draft', async () => {
    const { rows } = await query<{ id: number }>(
      `INSERT INTO aegis_outbound_drafts
         (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
       VALUES ('twitter', 'breaking', 'anchor', 'pre-approved', '{"tweets":[{"text":"x"}]}'::jsonb, 'drafted', $1)
       RETURNING id`,
      [TEST_MARKER],
    );
    const r = await publishDraft(rows[0]!.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_approved');
    expect(mockPostTweet).not.toHaveBeenCalled();
  });

  it('returns unsupported_channel for rss (regenerated from the DB, not dispatched)', async () => {
    // `email` is now fully dispatched (render + Resend), so it is NOT an
    // unsupported channel. `rss` still has no draft dispatch — it regenerates
    // from the DB on the next public GET — so it remains the guard's subject.
    const { rows } = await query<{ id: number }>(
      `INSERT INTO aegis_outbound_drafts
         (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
       VALUES ('rss', 'daily_brief', 'anchor', 'rss-test', '{"tweets":[]}'::jsonb, 'approved', $1)
       RETURNING id`,
      [TEST_MARKER],
    );
    const r = await publishDraft(rows[0]!.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unsupported_channel');
    expect(mockPostTweet).not.toHaveBeenCalled();
  });
});

/**
 * Integration tests for the background X-post state machine. Uses the real DB
 * (like publish.test.ts) and mocks postCore + startImageGeneration so we assert
 * the transitions + single-flight without touching X or the image provider.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const mockPostCore = vi.fn();
const mockStartImage = vi.fn();

vi.mock('./post-core', async () => {
  const actual = await vi.importActual<typeof import('./post-core')>('./post-core');
  return { ...actual, postCore: (...a: unknown[]) => mockPostCore(...a) };
});
vi.mock('@/lib/visual/image-generation-service', () => ({
  startImageGeneration: (...a: unknown[]) => mockStartImage(...a),
}));

const { startXPostJob, advanceXPostJob, listActiveXPostJobs } = await import(
  './x-post-job-service'
);

const ACTOR = 'test:xpost@example.org';
const ACTOR_CTX = { id: ACTOR, ip: null, ua: null };

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_x_post_jobs WHERE actor_email = $1`, [ACTOR]);
  await query(`DELETE FROM aegis_generated_media WHERE style_tag = 'test-xpost-media'`);
}

async function seedMedia(status: string, blobUrl: string | null): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_generated_media (media_kind, style_tag, provider, model_version, status, blob_url)
     VALUES ('image','test-xpost-media','test','test',$1,$2) RETURNING id`,
    [status, blobUrl],
  );
  return Number(rows[0]!.id);
}

async function start(overrides: Record<string, unknown> = {}) {
  return startXPostJob({
    actorEmail: ACTOR,
    primaryText: 'Gogs RCE — patch tonight.',
    publishMode: 'two_post',
    replyMode: 'text',
    replyText: 'Sources for the desk.',
    sourceUrl: 'https://example.com/gogs',
    messageTimestamp: 1_779_000_000_000,
    ...overrides,
  });
}

beforeEach(() => {
  mockPostCore.mockReset();
  mockStartImage.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('startXPostJob', () => {
  it('inserts a queued job and returns a view with a poll url', async () => {
    const v = await start();
    expect(v.ok).toBe(true);
    expect(v.status).toBe('queued');
    expect(v.jobToken).toMatch(/^xpost_/);
    expect(v.pollUrl).toBe(`/api/outbound/x/jobs/${v.jobToken}`);
    expect(v.messageTimestamp).toBe(1_779_000_000_000); // echoed back so the client can seed the image inline
    expect((await listActiveXPostJobs(ACTOR)).map((j) => j.jobToken)).toContain(v.jobToken);
  });
});

describe('advanceXPostJob — transitions', () => {
  it('queued (text) → posting', async () => {
    const { jobToken } = await start({ replyMode: 'text' });
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'posting' });
    expect(mockStartImage).not.toHaveBeenCalled();
  });

  it('queued (generate_image) → generating_image + kicks off image gen', async () => {
    mockStartImage.mockResolvedValueOnce({
      ok: true,
      __generated_media: true,
      mediaKind: 'image',
      generatedMediaId: '4242',
      status: 'pending',
    });
    const { jobToken } = await start({ replyMode: 'generate_image' });
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'generating_image', generatedMediaId: '4242' });
    expect(mockStartImage).toHaveBeenCalledTimes(1);
  });

  it('generating_image → posting once the media row is ready', async () => {
    const mediaId = await seedMedia('ready', 'https://blob.example/x.png');
    const { jobToken } = await start({ replyMode: 'generate_image' });
    await query(
      `UPDATE aegis_x_post_jobs SET status='generating_image', generated_media_id=$2 WHERE job_token=$1`,
      [jobToken, mediaId],
    );
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'posting' });
  });

  it('posting → posted with tweet ids when postCore succeeds', async () => {
    mockPostCore.mockResolvedValueOnce({
      ok: true,
      tweetIds: ['p-1', 'r-1'],
      replyTweetId: 'r-1',
      partial: false,
      outboundLogId: 9,
    });
    const { jobToken } = await start();
    await query(`UPDATE aegis_x_post_jobs SET status='posting' WHERE job_token=$1`, [jobToken]);
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'posted', tweetIds: ['p-1', 'r-1'] });
  });

  it('posting → needs_reconnect on no_token', async () => {
    mockPostCore.mockResolvedValueOnce({
      ok: false,
      error: 'no_token',
      detail: 'connect first',
      tweetIds: [],
      replyTweetId: null,
      partial: false,
      outboundLogId: null,
    });
    const { jobToken } = await start();
    await query(`UPDATE aegis_x_post_jobs SET status='posting' WHERE job_token=$1`, [jobToken]);
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'needs_reconnect', errorCode: 'no_token' });
  });

  it('posting → needs_reconnect when X rejects the token (401 survives a refresh)', async () => {
    // A `twitter_api_error` with HTTP 401 means the token is dead on X's side
    // and the in-client refresh+retry already failed — the operator must
    // reconnect, so surface the reconnect prompt instead of a dead-end "failed".
    mockPostCore.mockResolvedValueOnce({
      ok: false,
      error: 'twitter_api_error',
      detail: 'Unauthorized',
      status: 401,
      tweetIds: [],
      replyTweetId: null,
      partial: false,
      outboundLogId: null,
    });
    const { jobToken } = await start();
    await query(`UPDATE aegis_x_post_jobs SET status='posting' WHERE job_token=$1`, [jobToken]);
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'needs_reconnect' });
  });

  it('posting → failed for a non-auth twitter_api_error (e.g. 403/duplicate)', async () => {
    // A non-401 API error is a genuine failure, not a reconnect signal.
    mockPostCore.mockResolvedValueOnce({
      ok: false,
      error: 'twitter_api_error',
      detail: 'duplicate content',
      status: 403,
      tweetIds: [],
      replyTweetId: null,
      partial: false,
      outboundLogId: null,
    });
    const { jobToken } = await start();
    await query(`UPDATE aegis_x_post_jobs SET status='posting' WHERE job_token=$1`, [jobToken]);
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'failed', errorCode: 'twitter_api_error' });
  });

  it('single-flights concurrent advances on a posting job — postCore runs once', async () => {
    mockPostCore.mockResolvedValue({
      ok: true,
      tweetIds: ['p-1'],
      replyTweetId: null,
      partial: false,
      outboundLogId: 1,
    });
    const { jobToken } = await start();
    await query(`UPDATE aegis_x_post_jobs SET status='posting' WHERE job_token=$1`, [jobToken]);
    await Promise.all([
      advanceXPostJob(jobToken, ACTOR, ACTOR_CTX),
      advanceXPostJob(jobToken, ACTOR, ACTOR_CTX),
    ]);
    expect(mockPostCore).toHaveBeenCalledTimes(1);
    const { rows } = await query<{ status: string }>(
      `SELECT status FROM aegis_x_post_jobs WHERE job_token=$1`,
      [jobToken],
    );
    expect(rows[0]!.status).toBe('posted');
  });
});

describe('advanceXPostJob — guards', () => {
  it('returns forbidden for a different actor', async () => {
    const { jobToken } = await start();
    expect(await advanceXPostJob(jobToken, 'someone-else@x.io', { id: 'x' })).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
  });

  it('returns not_found for an unknown token', async () => {
    expect(await advanceXPostJob('xpost_nope', ACTOR, ACTOR_CTX)).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('is a no-op on a terminal job', async () => {
    const { jobToken } = await start();
    await query(`UPDATE aegis_x_post_jobs SET status='posted' WHERE job_token=$1`, [jobToken]);
    const r = await advanceXPostJob(jobToken, ACTOR, ACTOR_CTX);
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    expect(mockPostCore).not.toHaveBeenCalled();
  });
});

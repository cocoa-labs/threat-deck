import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';
import { connectRedis, disconnectRedis } from '@/lib/redis/client';

vi.unmock('@/lib/security/route-policy');
vi.unmock('@/lib/storage/private-files');
const owner = 'composer-test@example.org';
const mockPost = vi.hoisted(() => vi.fn());
const mockUpload = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({
  auth: async () => ({ user: { email: 'composer-test@example.org' } }),
}));
vi.mock('@/lib/ws/server', () => ({ broadcast: vi.fn() }));
vi.mock('@/lib/audit', async (original) => ({
  ...(await original<object>()),
  recordAudit: vi.fn(),
}));
vi.mock('@/lib/twitter/write-client', async (original) => ({
  ...(await original<object>()),
  postTweet: mockPost,
  uploadTweetImageFromUrl: mockUpload,
}));
const { POST: stage } = await import('./route');
const { POST: approve } = await import('../../drafts/[id]/approve/route');
const { updateDraftPayload } = await import('@/lib/outbound/mutations');
const origin = 'http://localhost:3302';
const text = 'Synthetic security update. #AICyber';
let mediaId = '';

beforeAll(connectRedis);
afterAll(disconnectRedis);

function request(path: string, body: unknown) {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function save() {
  const response = await stage(
    request('/api/outbound/x/review', {
      text,
      publishMode: 'single',
      replyMode: 'latest_image',
      imageBlobUrl: `/api/outbound/generated-media/${mediaId}/content`,
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).draftId as number;
}
function publish(id: number) {
  return approve(
    request(`/api/outbound/drafts/${id}/approve`, {
      publish: true,
      reviewedPayload: {
        canonicalHashtag: '#AICyber',
        tweets: [{ text }],
        mediaId,
        mediaKind: 'image',
      },
    }),
    { params: { id: String(id) } },
  );
}

beforeEach(async () => {
  vi.stubEnv('ALLOWED_EMAILS', owner);
  vi.stubEnv('NEXTAUTH_URL', origin);
  vi.stubEnv('TWITTER_DEV_HANDLE_OVERRIDE', '1');
  mockPost
    .mockReset()
    .mockResolvedValue({ ok: true, tweetId: '1999999999999999999', dryRun: false });
  mockUpload.mockReset().mockResolvedValue({ ok: true, mediaId: 'synthetic-upload' });
  const result = await query<{ id: string }>(
    `INSERT INTO aegis_generated_media
    (media_kind, style_tag, provider, model_version, status, blob_url, owner_email)
    VALUES ('image', 'test-composer', 'test', 'test', 'ready',
    'https://store.private.blob.vercel-storage.com/composer.png', $1) RETURNING id::text`,
    [owner],
  );
  mediaId = result.rows[0]!.id;
});
afterEach(async () => {
  const ids = await query<{ id: string }>(
    'SELECT id::text FROM aegis_outbound_drafts WHERE created_by = $1',
    [owner],
  );
  await query('DELETE FROM aegis_outbound_drafts WHERE created_by = $1', [owner]);
  await query(
    "DELETE FROM aegis_outbound_log WHERE entity_kind = 'draft' AND entity_id = ANY($1::text[])",
    [ids.rows.map((row) => row.id)],
  );
  await query('DELETE FROM aegis_generated_media WHERE owner_email = $1', [owner]);
  vi.unstubAllEnvs();
});

it('stages without sending, then publishes the exact reviewed text and image once', async () => {
  const id = await save();
  expect(mockPost).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
  const response = await publish(id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    ok: true,
    status: 'published',
    tweetIds: ['1999999999999999999'],
    dryRun: false,
  });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledExactlyOnceWith({
    text,
    mediaIds: ['synthetic-upload'],
    replyToTweetId: undefined,
    dryRun: false,
  });
  expect((await publish(id)).status).toBe(409);
  expect(mockPost).toHaveBeenCalledTimes(1);
});

it('refuses publication if another operator edited the draft after the composer review', async () => {
  const id = await save();
  await updateDraftPayload(
    id,
    { canonicalHashtag: '#AICyber', tweets: [{ text: 'Changed #AICyber' }] },
    owner,
  );
  expect((await publish(id)).ok).toBe(false);
  expect(mockPost).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
});

it('refuses media belonging to another operator before staging or sending', async () => {
  await query('UPDATE aegis_generated_media SET owner_email = $1 WHERE id = $2', [
    'someone-else@example.org',
    mediaId,
  ]);
  try {
    const response = await stage(
      request('/api/outbound/x/review', {
        text,
        publishMode: 'single',
        imageBlobUrl: `/api/outbound/generated-media/${mediaId}/content`,
      }),
    );
    expect(response.ok).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  } finally {
    await query('DELETE FROM aegis_generated_media WHERE id = $1', [mediaId]);
  }
});

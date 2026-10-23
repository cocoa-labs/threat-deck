import { beforeEach, expect, it, vi } from 'vitest';

vi.unmock('@/lib/storage/private-files');
const fixtures = vi.hoisted(() => ({ rows: [] as Record<string, string>[] }));
vi.mock('@/lib/db/client', () => ({ query: vi.fn(async () => ({ rows: fixtures.rows })) }));

import { query } from '@/lib/db/client';
import { ownedMediaUrl, ownsDraftMedia } from './media-ownership';

beforeEach(() => {
  fixtures.rows = [];
  vi.clearAllMocks();
});
it('denies another operator’s private media even if the path is known', async () => {
  await expect(
    ownedMediaUrl('/api/outbound/generated-media/17/content', 'a@example.org'),
  ).rejects.toThrow('media_not_owned');
  expect(query).toHaveBeenCalledWith(expect.stringContaining('owner_email = $2'), [
    '17',
    'a@example.org',
  ]);
});
it('accepts only an owned ready object in the private store', async () => {
  fixtures.rows = [{ blob_url: 'https://store.private.blob.vercel-storage.com/private/image.png' }];
  expect(
    await ownedMediaUrl('/api/outbound/generated-media/17/content', 'a@example.org'),
  ).toContain('.private.blob.');
  await expect(
    ownedMediaUrl('http://169.254.169.254/latest/meta-data', 'a@example.org'),
  ).rejects.toThrow();
});
it('requires ownership of every media ID during draft edits', async () => {
  fixtures.rows = [{ id: '1' }];
  expect(await ownsDraftMedia({ mediaIds: ['1', '2'] }, 'a@example.org')).toBe(false);
  expect(await ownsDraftMedia({ mediaIds: ['1'] }, 'a@example.org')).toBe(true);
  expect(await ownsDraftMedia({ mediaIds: ['1 OR true'] }, 'a@example.org')).toBe(false);
  expect(await ownsDraftMedia({ mediaId: '1', mediaIds: ['2'] }, 'a@example.org')).toBe(false);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('owner_email = $2'), [
    ['1', '2'],
    'a@example.org',
  ]);
});

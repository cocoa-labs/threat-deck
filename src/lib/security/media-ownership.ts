import { query } from '@/lib/db/client';
import { privatePathFromUrl } from '@/lib/storage/private-files';

/** Private media stays scoped to its creator even inside the shared team queue. */
export async function ownsDraftMedia(
  payload: Record<string, unknown>,
  owner: string,
): Promise<boolean> {
  if (payload.mediaIds !== undefined && !Array.isArray(payload.mediaIds)) return false;
  const ids = [
    ...(payload.mediaId === undefined ? [] : [payload.mediaId]),
    ...((payload.mediaIds ?? []) as unknown[]),
  ];
  if (ids.some((id) => typeof id !== 'string' || !/^\d+$/.test(id))) return false;
  if (!ids.length) return true;
  if (ids.length > 4 || !owner) return false;
  const result = await query<{ id: string }>(
    'SELECT id::text FROM aegis_generated_media WHERE id = ANY($1::bigint[]) AND owner_email = $2',
    [ids, owner],
  );
  return new Set(result.rows.map((row) => row.id)).size === new Set(ids).size;
}

/** Resolve a UI content URL or a store URL only after checking its database owner. */
export async function ownedMediaUrl(reference: string, owner: string): Promise<string> {
  const contentId = /^\/api\/outbound\/generated-media\/(\d+)\/content$/.exec(reference)?.[1];
  if (!contentId) privatePathFromUrl(reference);
  const result = await query<{ blob_url: string }>(
    `SELECT blob_url FROM aegis_generated_media
     WHERE ${contentId ? 'id = $1::bigint' : 'blob_url = $1'} AND owner_email = $2 AND status = 'ready'`,
    [contentId ?? reference, owner],
  );
  const url = result.rows[0]?.blob_url;
  if (!url) throw new Error('media_not_owned');
  privatePathFromUrl(url);
  return url;
}

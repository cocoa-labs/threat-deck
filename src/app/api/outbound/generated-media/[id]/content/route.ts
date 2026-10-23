import { auth } from '@/lib/auth';
import { queryOne } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';
import {
  privateFileResponse,
  privatePathFromUrl,
  readPrivateFile,
} from '@/lib/storage/private-files';

export const GET = withRoutePolicy(
  '/api/outbound/generated-media/[id]/content',
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const email = (await auth())?.user?.email;
    if (!email || !/^\d{1,18}$/.test(id))
      return Response.json({ error: 'not_found' }, { status: 404 });
    const row = await queryOne<{ blob_url: string; media_kind: string }>(
      `SELECT blob_url, media_kind FROM aegis_generated_media
     WHERE id = $1 AND owner_email = $2 AND status IN ('ready', 'published')`,
      [id, email],
    );
    if (!row?.blob_url) return Response.json({ error: 'not_found' }, { status: 404 });
    const video = row.media_kind === 'video';
    const bytes = await readPrivateFile(
      privatePathFromUrl(row.blob_url),
      video ? 64 * 1024 * 1024 : 16 * 1024 * 1024,
    );
    return privateFileResponse(
      bytes,
      `media-${id}.${video ? 'mp4' : 'png'}`,
      video ? 'video/mp4' : 'image/png',
    );
  },
);

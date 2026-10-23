import { isUuid } from '@/lib/agent/attachments/validation';
import { auth } from '@/lib/auth';
import { getAttachmentForOwner } from '@/lib/db/queries/attachments';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { privateFileResponse, readPrivateFile } from '@/lib/storage/private-files';

export const GET = withRoutePolicy(
  '/api/agent/attachments/[id]/content',
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const ownerEmail = (await auth())?.user?.email;
    if (!ownerEmail || !isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 });
    const row = await getAttachmentForOwner({ id, ownerEmail });
    if (!row?.blob_pathname || row.status === 'deleted')
      return Response.json({ error: 'not_found' }, { status: 404 });
    return privateFileResponse(
      await readPrivateFile(row.blob_pathname),
      row.filename,
      row.content_type,
    );
  },
);

import { retryAttachmentDeletions } from '@/lib/agent/attachments/blob-cleanup';
import { isUuid } from '@/lib/agent/attachments/validation';
import { auth } from '@/lib/auth';
import { pendingAttachmentDeletions } from '@/lib/db/queries/attachment-deletions';
import { softDeleteAttachmentForOwner } from '@/lib/db/queries/attachments';
import { withRoutePolicy } from '@/lib/security/route-policy';
export const runtime = 'nodejs';
async function routeDELETEImplementation(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ownerEmail = (await auth())?.user?.email;
  if (!ownerEmail) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!isUuid(id))
    return Response.json({ ok: false, error: 'invalid_attachment_id' }, { status: 400 });
  const deleted = await softDeleteAttachmentForOwner({ id, ownerEmail });
  if (!deleted) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  await retryAttachmentDeletions(ownerEmail);
  const pending = await pendingAttachmentDeletions(ownerEmail, id);
  return Response.json(
    {
      ok: true,
      accessRevoked: true,
      storageDeletion: pending ? 'pending' : 'complete',
      pendingFiles: pending,
    },
    { status: pending ? 202 : 200 },
  );
}
export const DELETE = withRoutePolicy('/api/agent/attachments/[id]', routeDELETEImplementation);

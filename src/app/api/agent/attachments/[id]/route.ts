import { deleteAttachmentBlobs } from '@/lib/agent/attachments/blob-cleanup';
import { isUuid, toAttachmentSummary } from '@/lib/agent/attachments/validation';
import { auth } from '@/lib/auth';
import { getAttachmentForOwner, softDeleteAttachmentForOwner } from '@/lib/db/queries/attachments';
import { withRoutePolicy } from '@/lib/security/route-policy';

export const runtime = 'nodejs';

async function routeDELETEImplementation(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  const ownerEmail = session?.user?.email;
  if (!ownerEmail) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json({ ok: false, error: 'invalid_attachment_id' }, { status: 400 });
  }

  const existing = await getAttachmentForOwner({ id, ownerEmail });
  if (!existing) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const deleted = await softDeleteAttachmentForOwner({ id, ownerEmail });
  if (deleted) await deleteAttachmentBlobs(deleted);
  return Response.json({
    ok: true,
    attachment: deleted ? toAttachmentSummary(deleted) : toAttachmentSummary(existing),
  });
}

export const DELETE = withRoutePolicy('/api/agent/attachments/[id]', routeDELETEImplementation);

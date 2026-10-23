import { retryAttachmentDeletions } from '@/lib/agent/attachments/blob-cleanup';
import { toAttachmentSummary } from '@/lib/agent/attachments/validation';
import { auth } from '@/lib/auth';
import { pendingAttachmentDeletions } from '@/lib/db/queries/attachment-deletions';
import {
  listAttachmentsForOwner,
  softDeleteChatAttachmentsForOwner,
} from '@/lib/db/queries/attachments';
import { withRoutePolicy } from '@/lib/security/route-policy';

export const runtime = 'nodejs';

async function routeGETImplementation(): Promise<Response> {
  const session = await auth();
  const ownerEmail = session?.user?.email;
  if (!ownerEmail) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const rows = await listAttachmentsForOwner({ ownerEmail });
  return Response.json({
    ok: true,
    attachments: rows.map(toAttachmentSummary),
    pendingDeletions: await pendingAttachmentDeletions(ownerEmail),
  });
}

async function routeDELETEImplementation(): Promise<Response> {
  const session = await auth();
  const ownerEmail = session?.user?.email;
  if (!ownerEmail) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const rows = await softDeleteChatAttachmentsForOwner(ownerEmail);
  await retryAttachmentDeletions(ownerEmail);
  const pending = await pendingAttachmentDeletions(ownerEmail);
  return Response.json(
    {
      ok: true,
      deleted: rows.length,
      storageDeletion: pending ? 'pending' : 'complete',
      pendingFiles: pending,
    },
    { status: pending ? 202 : 200 },
  );
}

export const GET = withRoutePolicy('/api/agent/attachments', routeGETImplementation);
export const DELETE = withRoutePolicy('/api/agent/attachments', routeDELETEImplementation);

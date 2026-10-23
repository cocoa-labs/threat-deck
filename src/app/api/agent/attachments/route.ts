import { deleteAttachmentBlobs } from '@/lib/agent/attachments/blob-cleanup';
import { toAttachmentSummary } from '@/lib/agent/attachments/validation';
import { auth } from '@/lib/auth';
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
  return Response.json({ ok: true, attachments: rows.map(toAttachmentSummary) });
}

async function routeDELETEImplementation(): Promise<Response> {
  const session = await auth();
  const ownerEmail = session?.user?.email;
  if (!ownerEmail) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const rows = await softDeleteChatAttachmentsForOwner(ownerEmail);
  await Promise.allSettled(rows.map((row) => deleteAttachmentBlobs(row)));
  return Response.json({ ok: true, deleted: rows.length });
}

export const GET = withRoutePolicy('/api/agent/attachments', routeGETImplementation);
export const DELETE = withRoutePolicy('/api/agent/attachments', routeDELETEImplementation);

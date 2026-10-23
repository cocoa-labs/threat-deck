import { retryAttachmentDeletions } from '@/lib/agent/attachments/blob-cleanup';
import { auth } from '@/lib/auth';
import { pendingAttachmentDeletions } from '@/lib/db/queries/attachment-deletions';
import { withRoutePolicy } from '@/lib/security/route-policy';
export const POST = withRoutePolicy('/api/agent/attachments/cleanup', async () => {
  const owner = (await auth())?.user?.email;
  if (!owner) return Response.json({ ok: false }, { status: 401 });
  await retryAttachmentDeletions(owner);
  const pending = await pendingAttachmentDeletions(owner);
  return Response.json({ ok: true, pendingDeletions: pending }, { status: pending ? 202 : 200 });
});

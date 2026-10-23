import { processAgentAttachment } from '@/lib/agent/attachments/parser';
import { isUuid, toAttachmentSummary } from '@/lib/agent/attachments/validation';
import { auth } from '@/lib/auth';
import {
  completeAttachmentProcessing,
  failAttachmentProcessing,
  getAttachmentForOwner,
  markAttachmentProcessing,
  markAttachmentUploaded,
} from '@/lib/db/queries/attachments';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { privatePathFromUrl } from '@/lib/storage/private-files';

export const runtime = 'nodejs';

type ProcessBody = {
  blob?: {
    url?: unknown;
    pathname?: unknown;
    contentType?: unknown;
    size?: unknown;
  };
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function routePOSTImplementation(
  request: Request,
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

  let body: ProcessBody = {};
  try {
    body = (await request.json()) as ProcessBody;
  } catch {
    body = {};
  }

  const existing = await getAttachmentForOwner({ id, ownerEmail });
  if (!existing) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (existing.status === 'ready') {
    return Response.json({ ok: true, attachment: toAttachmentSummary(existing) });
  }

  const blob = body.blob;
  if (
    blob &&
    typeof blob.url === 'string' &&
    typeof blob.pathname === 'string' &&
    (typeof blob.size === 'number' || blob.size == null)
  ) {
    if (
      privatePathFromUrl(blob.url) !== blob.pathname ||
      !blob.pathname.startsWith(`agent-attachments/uploads/${id}/`)
    ) {
      return Response.json({ ok: false, error: 'invalid_attachment_path' }, { status: 400 });
    }
    await markAttachmentUploaded({
      id,
      ownerEmail,
      blobUrl: blob.url,
      blobPathname: blob.pathname,
      contentType: typeof blob.contentType === 'string' ? blob.contentType : existing.content_type,
      sizeBytes: typeof blob.size === 'number' ? blob.size : undefined,
    });
  }

  const processing = await markAttachmentProcessing({ id, ownerEmail });
  if (!processing)
    return Response.json(
      { ok: false, error: 'attachment_processing_in_progress' },
      { status: 409 },
    );
  const row = processing;
  if (!row?.blob_url) {
    await failAttachmentProcessing({
      id,
      ownerEmail,
      errorMessage: 'uploaded_blob_missing',
    });
    return Response.json({ ok: false, error: 'uploaded_blob_missing' }, { status: 400 });
  }

  try {
    const result = await processAgentAttachment(row);
    const completed = await completeAttachmentProcessing({
      id,
      ownerEmail,
      parsedText: result.parsedText,
      summary: result.summary,
      structured: result.structured,
      sha256: result.sha256,
      modelBlob: result.modelBlob,
    });
    if (!completed) {
      return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return Response.json({ ok: true, attachment: toAttachmentSummary(completed) });
  } catch (err) {
    const message = getErrorMessage(err);
    const failed = await failAttachmentProcessing({ id, ownerEmail, errorMessage: message });
    return Response.json(
      {
        ok: false,
        error: 'attachment_processing_failed',
        detail: message,
        attachment: failed ? toAttachmentSummary(failed) : undefined,
      },
      { status: 500 },
    );
  }
}

export const POST = withRoutePolicy('/api/agent/attachments/[id]/process', routePOSTImplementation);

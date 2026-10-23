import type { HandleUploadBody } from '@vercel/blob/client';
import { handleUpload } from '@vercel/blob/client';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ACTIVE_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  safeAttachmentPath,
  validateAttachmentInput,
} from '@/lib/agent/attachments/validation';
import { auth } from '@/lib/auth';
import { isEmailAllowed } from '@/lib/auth/allowlist';
import {
  countActiveAttachmentsForOwner,
  createPendingAttachment,
  markAttachmentUploaded,
} from '@/lib/db/queries/attachments';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { privatePathFromUrl } from '@/lib/storage/private-files';

export const runtime = 'nodejs';

type UploadClientPayload = {
  id?: unknown;
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
};

type UploadTokenPayload = {
  id: string;
  ownerEmail: string;
};

function parseClientPayload(raw: string | null): UploadClientPayload {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as UploadClientPayload;
  } catch {
    return {};
  }
}

function parseTokenPayload(raw: string | null | undefined): UploadTokenPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UploadTokenPayload>;
    if (!parsed.id || !parsed.ownerEmail) return null;
    return { id: parsed.id, ownerEmail: parsed.ownerEmail };
  } catch {
    return null;
  }
}

async function routePOSTImplementation(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  let ownerEmail: string | null = null;
  if (body.type === 'blob.generate-client-token') {
    const session = await auth();
    ownerEmail = session?.user?.email ?? null;
    if (!ownerEmail) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      async onBeforeGenerateToken(pathname, clientPayload) {
        if (!ownerEmail || !isEmailAllowed(ownerEmail)) throw new Error('unauthorized');
        const payload = parseClientPayload(clientPayload);
        const id = typeof payload.id === 'string' ? payload.id : '';
        const filename = typeof payload.filename === 'string' ? payload.filename : '';
        const contentType =
          typeof payload.contentType === 'string' ? payload.contentType : undefined;
        const sizeBytes = typeof payload.sizeBytes === 'number' ? payload.sizeBytes : -1;
        const validated = validateAttachmentInput({ id, filename, contentType, sizeBytes });
        if (!validated.ok) throw new Error(validated.error);

        const expectedPrefix = `agent-attachments/uploads/${id}/`;
        if (!pathname.startsWith(expectedPrefix) || pathname !== safeAttachmentPath(id, filename)) {
          throw new Error('invalid_attachment_path');
        }

        const activeCount = await countActiveAttachmentsForOwner(ownerEmail);
        if (activeCount >= MAX_ACTIVE_ATTACHMENTS) {
          throw new Error('active_attachment_cap_reached');
        }

        await createPendingAttachment({
          id,
          ownerEmail,
          filename: validated.filename,
          contentType: validated.contentType,
          sizeBytes,
          kind: validated.kind,
        });

        return {
          allowedContentTypes: [...ALLOWED_ATTACHMENT_MIME_TYPES],
          maximumSizeInBytes: MAX_ATTACHMENT_BYTES,
          validUntil: Date.now() + 15 * 60 * 1000,
          addRandomSuffix: false,
          cacheControlMaxAge: 0,
          tokenPayload: JSON.stringify({ id, ownerEmail }),
        };
      },
      async onUploadCompleted({ blob, tokenPayload }) {
        const payload = parseTokenPayload(tokenPayload);
        if (!payload || !isEmailAllowed(payload.ownerEmail)) throw new Error('unauthorized');
        if (
          privatePathFromUrl(blob.url) !== blob.pathname ||
          !blob.pathname.startsWith(`agent-attachments/uploads/${payload.id}/`)
        )
          throw new Error('invalid_private_upload');
        await markAttachmentUploaded({
          id: payload.id,
          ownerEmail: payload.ownerEmail,
          blobUrl: blob.url,
          blobPathname: blob.pathname,
          contentType: blob.contentType,
        });
      },
    });

    return Response.json(jsonResponse);
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'attachment_upload_failed' },
      { status: 400 },
    );
  }
}

export const POST = withRoutePolicy('/api/agent/attachments/upload', routePOSTImplementation);

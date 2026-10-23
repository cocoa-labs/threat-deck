import { privateBlobResponse } from '@/lib/storage/private-files';
/**
 * Build Resend email attachments from generated-media blob URLs.
 *
 * Fetches each public Vercel Blob URL, size-guards it (base64 inflates ~33%, so
 * we cap raw bytes well under Resend's ~40MB total-message limit), and base64-
 * encodes it into the EmailAttachment shape. Never throws — anything that can't
 * be attached is reported in `skipped` so the caller can still send the email.
 */

import { Buffer } from 'node:buffer';
import type { EmailAttachment } from '@/lib/email/resend';

// Keep raw bytes under ~25MB so the base64 payload stays under Resend's ~40MB cap.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface MediaAttachmentItem {
  blobUrl: string;
  kind: 'image' | 'video';
}

export interface BuiltAttachments {
  attachments: EmailAttachment[];
  skipped: Array<{ blobUrl: string; reason: string }>;
}

export async function buildMediaAttachments(
  items: MediaAttachmentItem[],
): Promise<BuiltAttachments> {
  const attachments: EmailAttachment[] = [];
  const skipped: Array<{ blobUrl: string; reason: string }> = [];
  let imageCount = 0;
  let videoCount = 0;

  for (const item of items) {
    const url = typeof item.blobUrl === 'string' ? item.blobUrl.trim() : '';
    if (!url) {
      skipped.push({ blobUrl: String(item.blobUrl), reason: 'empty url' });
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      skipped.push({ blobUrl: url, reason: 'invalid url' });
      continue;
    }
    if (parsed.protocol !== 'https:') {
      skipped.push({ blobUrl: url, reason: 'must be https' });
      continue;
    }

    let res: Response;
    try {
      res = await privateBlobResponse(url, 25 * 1024 * 1024);
    } catch (err) {
      skipped.push({
        blobUrl: url,
        reason: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!res.ok) {
      skipped.push({ blobUrl: url, reason: `fetch HTTP ${res.status}` });
      continue;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      skipped.push({ blobUrl: url, reason: 'empty file' });
      continue;
    }
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      skipped.push({ blobUrl: url, reason: `too large for email (${buf.length} bytes)` });
      continue;
    }

    const headerType = res.headers.get('content-type')?.split(';')[0]?.trim();
    const isVideo = item.kind === 'video';
    const ext = isVideo ? 'mp4' : 'png';
    const contentType = headerType || (isVideo ? 'video/mp4' : 'image/png');
    const n = isVideo ? ++videoCount : ++imageCount;
    const base = isVideo ? 'cocoa-clip' : 'cocoa-infographic';
    const filename = n > 1 ? `${base}-${n}.${ext}` : `${base}.${ext}`;

    attachments.push({ filename, content: buf.toString('base64'), contentType });
  }

  return { attachments, skipped };
}

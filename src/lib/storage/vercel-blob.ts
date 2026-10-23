/**
 * Vercel Blob storage client wrapper for visual generation (Phase 14 Tier A).
 *
 * Provides a thin, audit-friendly interface over @vercel/blob's put/del/head.
 * Used by:
 *   - src/lib/visual/orchestrator.ts (uploads composite PNG after generation)
 *   - Future Tier C (video upload)
 *   - SP2(a) multi-modal vision (operator-uploaded screenshots)
 *
 * BLOB_READ_WRITE_TOKEN is auto-provisioned by `vercel link` in development.
 * In production, it's set by Vercel's environment automatically.
 */

import { del, head, put } from '@vercel/blob';

export interface BlobUploadResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
}

export interface UploadOptions {
  timeoutMs?: number;
  contentType?: string;
  cacheControlMaxAge?: number; // seconds; default 1 year
  addRandomSuffix?: boolean; // default true to prevent collisions
}

export async function uploadVisualBlob(
  pathnamePrefix: string,
  data: Buffer,
  options: UploadOptions = {},
): Promise<BlobUploadResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN && process.env.NODE_ENV === 'production') {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is missing in production. Run `vercel link` or set it in env.',
    );
  }

  const result = await put(pathnamePrefix, data, {
    access: 'private',
    ...(options.timeoutMs ? { abortSignal: AbortSignal.timeout(options.timeoutMs) } : {}),
    contentType: options.contentType ?? 'application/octet-stream',
    cacheControlMaxAge: options.cacheControlMaxAge ?? 0,
    addRandomSuffix: options.addRandomSuffix ?? true,
  });

  return {
    url: result.url,
    pathname: result.pathname,
    contentType: result.contentType,
    size: data.byteLength,
  };
}

export async function deleteVisualBlob(pathname: string): Promise<void> {
  await del(pathname, { abortSignal: AbortSignal.timeout(10_000) });
}

export async function headVisualBlob(pathname: string): Promise<BlobUploadResult | null> {
  try {
    const result = await head(pathname);
    return {
      url: result.url,
      pathname: result.pathname,
      contentType: result.contentType,
      size: result.size,
    };
  } catch {
    return null;
  }
}

import { get } from '@vercel/blob';

/** Only read paths in this installation's private store; no caller-supplied URLs. */
export async function readPrivateFile(
  pathname: string,
  maxBytes = 32 * 1024 * 1024,
): Promise<Buffer> {
  if (
    !pathname ||
    pathname.startsWith('/') ||
    pathname.includes('://') ||
    pathname.includes('..')
  ) {
    throw new Error('invalid_private_path');
  }
  const blob = await get(pathname, {
    access: 'private',
    useCache: false,
    abortSignal: AbortSignal.timeout(30_000),
  });
  if (blob?.statusCode !== 200) throw new Error('private_file_not_found');
  if (blob.blob.size > maxBytes) {
    await blob.stream.cancel();
    throw new Error('file_too_large');
  }
  const reader = blob.stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('file_too_large');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}

export function privatePathFromUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.private.blob.vercel-storage.com')) {
    throw new Error('not_private_storage');
  }
  // The SDK reads using this installation's token/store, not the URL's host.
  return decodeURIComponent(url.pathname.slice(1));
}

export function privateFileResponse(
  bytes: Buffer,
  filename: string,
  contentType: string,
): Response {
  const inline = /^image\/(png|jpeg|webp|gif)$/.test(contentType) || contentType === 'video/mp4';
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

/** Server-side publishing reads private bytes only after draft approval. */
export async function privateBlobResponse(
  url: string,
  maxBytes = 32 * 1024 * 1024,
): Promise<Response> {
  const pathname = privatePathFromUrl(url);
  const bytes = await readPrivateFile(pathname, maxBytes);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': pathname.endsWith('.mp4') ? 'video/mp4' : 'image/png',
    },
  });
}

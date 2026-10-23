const MAX_BODY_BYTES = 1024 * 1024;

/** Bound chunked bodies too; Content-Length alone is not a security boundary. */
export async function boundedRequest(request: Request): Promise<Request> {
  if (!request.body) return request;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 10_000);
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error('body_too_large');
      chunks.push(value);
    }
    // Cancellation can report done: validate a declared length before forwarding.
    if (timedOut || !completed || (declared > 0 && declared !== bytes))
      throw new Error('invalid_body');
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: Buffer.concat(chunks),
      signal: request.signal,
      duplex: 'half',
    } as RequestInit);
  } finally {
    clearTimeout(timeout);
    void reader.cancel();
    reader.releaseLock();
  }
}

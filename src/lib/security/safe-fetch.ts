import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as upstreamFetch } from 'undici';

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address.replace(/^\[|\]$/g, ''));
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

export async function validatePublicUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    url.hostname.endsWith('.local') ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost')
  )
    throw new Error('unsafe_url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new Error('unsafe_address');
  } else {
    const addresses = await boundedLookup(host);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      throw new Error('unsafe_address');
  }
  return url;
}

async function boundedLookup(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns_timeout')), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Validate at connection time as well as at URL validation, preventing DNS rebinding.
const dispatcher = new Agent({
  connections: 8,
  connect: {
    timeout: 8000,
    lookup(hostname, options, callback) {
      void boundedLookup(hostname)
        .then((addresses) => {
          if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
            callback(new Error('unsafe_address'), '', 4);
            return;
          }
          const selected = addresses.filter((a) => !options.family || a.family === options.family);
          if (!selected.length) {
            callback(new Error('no_address'), '', 4);
            return;
          }
          if (options.all) callback(null, selected);
          else callback(null, selected[0]!.address, selected[0]!.family);
        })
        .catch((error) => callback(error, '', 4));
    },
  },
});

/** Public upstreams only. Redirects, body bytes and the entire request are bounded. */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  maxBytes = 8 * 1024 * 1024,
): Promise<Response> {
  let url = await validatePublicUrl(String(input));
  const signal = AbortSignal.any([
    AbortSignal.timeout(15_000),
    ...(init.signal ? [init.signal] : []),
  ]);
  const headers = new Headers(init.headers);
  for (let hop = 0; hop <= 4; hop++) {
    const response = await upstreamFetch(url, {
      ...init,
      headers: Object.fromEntries(headers),
      redirect: 'manual',
      signal,
      dispatcher,
    } as Parameters<typeof upstreamFetch>[1]);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || hop === 4) throw new Error('redirect_limit');
      const next = await validatePublicUrl(new URL(location, url).toString());
      if (next.origin !== url.origin) {
        // Never forward API credentials or POST bodies to a redirected origin.
        if (init.method && init.method !== 'GET' && init.method !== 'HEAD')
          throw new Error('unsafe_redirect');
        for (const name of [...headers.keys()]) {
          if (!['accept', 'user-agent', 'accept-language'].includes(name)) headers.delete(name);
        }
      }
      url = next;
      continue;
    }
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      await response.body?.cancel();
      throw new Error('upstream_too_large');
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) throw new Error('upstream_too_large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
    }
    const resultHeaders = new Headers(Object.fromEntries(response.headers));
    resultHeaders.delete('content-encoding');
    resultHeaders.delete('content-length');
    return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), {
      status: response.status,
      headers: resultHeaders,
    });
  }
  throw new Error('redirect_limit');
}

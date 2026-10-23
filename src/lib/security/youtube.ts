export function extractYouTubeVideoId(input: string): string | null {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    let id: string | null = null;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
      id =
        url.searchParams.get('v') ??
        /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1] ??
        null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function parseYouTubeMessage(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  player: MessageEventSource | null | undefined,
): { event?: unknown; info?: unknown } | null {
  if (event.origin !== 'https://www.youtube.com' || !player || event.source !== player) return null;
  if (typeof event.data !== 'string' || event.data.length > 65_536) return null;
  try {
    const value: unknown = JSON.parse(event.data);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

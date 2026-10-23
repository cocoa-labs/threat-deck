/** Untrusted feed/LLM links may navigate only to web URLs or local app paths. */
export function safeLink(value: unknown): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject URL whitespace and control characters
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return '#';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '#';
  } catch {
    return '#';
  }
}

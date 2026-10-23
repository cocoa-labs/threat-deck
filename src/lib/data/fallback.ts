/** Synthetic samples are never a silent production fallback. */
export function markFallback<T extends object>(items: T[]): (T & { isFallback: boolean })[] {
  return items.map((item) => ({
    ...item,
    isFallback: true,
    _provenance: { state: 'demo', fetchedAt: null, expiresAt: null },
  }));
}
export function demoData<T extends object>(items: T[]): T[] {
  if (process.env.ENABLE_DEMO_DATA !== 'true') return [];
  return markFallback(items);
}

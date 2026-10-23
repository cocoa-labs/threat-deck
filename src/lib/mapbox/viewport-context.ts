/**
 * Request-scoped viewport context cache.
 *
 * Stores the viewport snapshot for the duration of an agent request.
 * Node.js is single-threaded — each agentic loop runs to completion
 * before the next request processes, so this is safe.
 *
 * The stream route sets the snapshot before the agent loop and clears
 * it after completion. Tool handlers read from it via getViewportContext().
 */

import type { ViewportSnapshot } from './viewport-features';

let _viewportSnapshot: ViewportSnapshot | null = null;

export function setViewportContext(snapshot: ViewportSnapshot | null): void {
  _viewportSnapshot = snapshot;
}

export function getViewportContext(): ViewportSnapshot | null {
  return _viewportSnapshot;
}

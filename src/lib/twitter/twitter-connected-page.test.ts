/**
 * Guards the OAuth landing page (`public/twitter-connected.html`).
 *
 * Two regressions this locks down:
 *  1. The page used to rely solely on `window.close()`. Every launch site is a
 *     plain <a href> (AgentToast / ApprovalQueueSection / PostToXButton), so the
 *     browser blocks close() and the user was stranded with no way back.
 *  2. A dead local database (`persist_failed`) rendered as "Twitter rejected the
 *     authorization", which sent debugging after X's API instead of Docker.
 *
 * The real shipped script is extracted and executed against fakes, so the test
 * fails if someone edits the HTML back into a dead end.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const HTML_PATH = resolve(process.cwd(), 'public/twitter-connected.html');

function extractInlineScript(): string {
  const html = readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error('no inline <script> found in twitter-connected.html');
  return match[1];
}

interface FakeEl {
  textContent: string;
  innerHTML: string;
  setAttribute: ReturnType<typeof vi.fn>;
  querySelector: () => { setAttribute: ReturnType<typeof vi.fn> };
}

function makeEl(): FakeEl {
  return {
    textContent: '',
    innerHTML: '',
    setAttribute: vi.fn(),
    querySelector: () => ({ setAttribute: vi.fn() }),
  };
}

/** Runs the page script with a blocked (no-op) close(), as a normal tab does. */
function runPage(search: string) {
  const els: Record<string, FakeEl> = {
    'status-line': makeEl(),
    message: makeEl(),
    reason: makeEl(),
    'back-link': makeEl(),
    countdown: makeEl(),
  };
  const replace = vi.fn();
  // A normal (non-script-opened) tab: close() is a silent no-op.
  const close = vi.fn();
  const win = { location: { search, replace }, close };
  const doc = { getElementById: (id: string) => els[id] ?? null };

  const fn = new Function(
    'window',
    'document',
    'setInterval',
    'setTimeout',
    'clearInterval',
    extractInlineScript(),
  );
  fn(win, doc, setInterval, setTimeout, clearInterval);

  return { els, replace, close };
}

describe('twitter-connected.html', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('navigates back to the dashboard when close() is blocked', () => {
    const { replace, close, els } = runPage('?status=ok');

    vi.advanceTimersByTime(5_000); // countdown hits zero
    vi.advanceTimersByTime(300); // close() fallback timer

    expect(close).toHaveBeenCalled();
    // The critical assertion: a blocked close() must not strand the user.
    expect(replace).toHaveBeenCalledWith('/');
    expect(els.countdown?.textContent).not.toMatch(/close this window manually/i);
  });

  it('counts down toward returning, not toward closing', () => {
    const { els } = runPage('?status=ok');
    vi.advanceTimersByTime(1_000);
    expect(els.countdown?.textContent).toMatch(/Returning in 4/);
  });

  it('blames the local database, not X, when the DB is unreachable', () => {
    const { els } = runPage('?status=error&reason=persist_failed_db_down');

    expect(els.message?.textContent).toMatch(/local database is unreachable/i);
    expect(els.message?.textContent).toMatch(/docker compose up -d/i);
    // Must NOT misattribute a local outage to X.
    expect(els.message?.textContent).not.toMatch(/Twitter rejected/i);
    expect(els.reason?.textContent).toBe('reason: persist_failed_db_down');
  });

  it('still reports a genuine X rejection as such', () => {
    const { els } = runPage('?status=error&reason=handle_lookup_failed');
    expect(els.message?.textContent).toMatch(/Twitter rejected the authorization/i);
  });
});

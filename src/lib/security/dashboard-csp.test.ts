/**
 * Guard for the dashboard Content Security Policy.
 *
 * Mapbox GL v3 runs its tile-decode/render worker from a `blob:` URL. If the
 * CSP has no `worker-src` (or one without `blob:`), the browser falls back to
 * `script-src`, blocks the worker, and the hero globe renders as a bare grey
 * sphere with no error — the exact failure this test exists to prevent. The
 * omission went unnoticed for ~two months because a blocked worker is a browser
 * SecurityError, not a Mapbox error event, so nothing surfaced it.
 *
 * Source-text assertion (like cyber-polling-floor.test.ts) rather than
 * importing next.config.ts — the config module runs env validation on import.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with cwd at the repo root.
const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

/** Pull the string literal assigned to a `const NAME = [ ... ].join("; ")` CSP block. */
function cspDirectives(constName: string): string[] {
  const block = config.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\]\\.join`));
  const body = block?.[1];
  if (!body) throw new Error(`Could not find ${constName} in next.config.ts`);
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

describe('DASHBOARD_CSP', () => {
  const directives = cspDirectives('DASHBOARD_CSP');
  const find = (name: string) => directives.find((d) => d.startsWith(`${name} `));

  it('allows the Mapbox GL blob worker via worker-src', () => {
    const workerSrc = find('worker-src');
    expect(
      workerSrc,
      'worker-src directive is missing — the Mapbox worker will be blocked',
    ).toBeDefined();
    expect(workerSrc).toContain('blob:');
  });

  it('allows the blob worker via child-src too (older Safari fallback)', () => {
    expect(find('child-src')).toContain('blob:');
  });

  it('keeps the Mapbox origins reachable', () => {
    // The style JSON, sprites, glyphs, and tiles all come from api.mapbox.com;
    // telemetry from events.mapbox.com. Losing either also greys the globe.
    expect(find('script-src')).toContain('https://api.mapbox.com');
    expect(find('connect-src')).toContain('https://api.mapbox.com');
    expect(find('connect-src')).toContain('https://events.mapbox.com');
  });

  it('still allows blob: images (marker/canvas sprites)', () => {
    expect(find('img-src')).toContain('blob:');
  });
});

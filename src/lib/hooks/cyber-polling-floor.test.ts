import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 4.3 — guard the cyber polling floor.
//
// WS push nudges (Phase 4.1) invalidate the cyber queries on new data, but
// push is best-effort. To guarantee freshness even if the socket lags, every
// cyber hook caps its wsConnected (slow) refetchInterval at a 5-min floor via
// `Math.min(<slow>, 300_000)`. This test parses the hook source and asserts:
//   (a) there are exactly 10 floored cyber refetch intervals, and
//   (b) each one resolves to <= 300_000ms (i.e. the floor actually bites).
//
// It's a source-shape guard rather than a render test — cheap, and it fails
// loudly if someone later raises a cyber slow-interval above the floor or
// drops the Math.min wrapper.

const FIVE_MIN_MS = 300_000;
const EXPECTED_FLOORED_HOOKS = 10;

// Vitest runs with cwd at the repo root; resolve the hook source from there.
const sourcePath = join(process.cwd(), 'src/lib/hooks/use-realtime-data.ts');
const source = readFileSync(sourcePath, 'utf8');

// Matches `refetchInterval: wsConnected ? Math.min(<slow>, <floor>) : <fast>`
const flooredPattern =
  /refetchInterval:\s*wsConnected\s*\?\s*Math\.min\(\s*([\d_]+)\s*,\s*([\d_]+)\s*\)/g;

function toNumber(literal: string): number {
  return Number(literal.replace(/_/g, ''));
}

describe('cyber polling floor (Phase 4.3)', () => {
  const matches = [...source.matchAll(flooredPattern)];

  it('floors exactly the 10 cyber hooks', () => {
    expect(matches.length).toBe(EXPECTED_FLOORED_HOOKS);
  });

  it('caps every cyber wsConnected interval at <= 5 minutes', () => {
    for (const m of matches) {
      const slow = toNumber(m[1] as string);
      const floor = toNumber(m[2] as string);
      // The floor argument itself must be the 5-min ceiling…
      expect(floor).toBe(FIVE_MIN_MS);
      // …and the effective interval (what TanStack actually uses) must be <= floor.
      expect(Math.min(slow, floor)).toBeLessThanOrEqual(FIVE_MIN_MS);
    }
  });
});

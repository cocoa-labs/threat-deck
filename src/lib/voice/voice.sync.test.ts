import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WRY_SHELF } from './index';
import { VOICE_REGISTER } from './register';

/**
 * Anti-drift guard. `agent/SOUL.md` §Voice Register is the human-authored
 * canon; `src/lib/voice/{register,index}.ts` are its code projections. If a
 * wry-shelf line is edited in one place but not the others, this fails loudly
 * in CI rather than letting the channels' voices silently diverge.
 *
 * Mirrors the drift-surface discipline CLAUDE.md already applies to the
 * citation-validator map.
 */
const SOUL = readFileSync(join(process.cwd(), 'agent', 'SOUL.md'), 'utf-8');

describe('voice spec sync (SOUL.md is canon)', () => {
  it('every WRY_SHELF line exists verbatim in SOUL.md', () => {
    for (const line of WRY_SHELF) {
      expect(SOUL, `WRY_SHELF line missing from SOUL.md: "${line}"`).toContain(line);
    }
  });

  it('every WRY_SHELF line exists verbatim in VOICE_REGISTER', () => {
    for (const line of WRY_SHELF) {
      expect(VOICE_REGISTER, `WRY_SHELF line missing from VOICE_REGISTER: "${line}"`).toContain(
        line,
      );
    }
  });

  it('the SOUL.md Voice Register section is present (canon guard)', () => {
    expect(SOUL).toContain('Voice Register');
  });
});

/**
 * Tests for the three-mode posture configuration and effective-mode resolver.
 *
 * The function under test, `computeEffectiveMode`, decides which mode the
 * agent runs in for a single turn given:
 *   - the user's locked mode (or null = AUTO, no lock)
 *   - the user's message (sniffed for Mode 2 / Mode 3 keywords)
 *   - panel-click context (true for prefilled-from-panel requests)
 *   - signal severity + KEV flag (for autonomous activations)
 *
 * Lock behavior is sticky-with-auto-escalation: an operator-locked Anchor
 * can be promoted to Analyst (on critical+KEV or Mode 2 keyword/panel-click)
 * or to Fix Architect (on Mode 3 keyword), but only for this turn. Locked
 * Analyst / Fix Architect never down-grade.
 */

import { describe, expect, it } from 'vitest';
import {
  type AgentMode,
  computeEffectiveMode,
  extractModeMarker,
  getModeAddendum,
  isEscalation,
  MODE_LEVEL,
  MODE_TOOL_BUDGET,
  parseLockedMode,
  stripAllModeMarkers,
} from './mode-config';

describe('MODE_TOOL_BUDGET', () => {
  it('caps anchor at 2 tool turns', () => {
    expect(MODE_TOOL_BUDGET.anchor).toBe(2);
  });

  it('caps analyst at 6 tool turns', () => {
    expect(MODE_TOOL_BUDGET.analyst).toBe(6);
  });

  it('caps fix-architect at 8 tool turns', () => {
    expect(MODE_TOOL_BUDGET['fix-architect']).toBe(8);
  });

  it('keeps all budgets below the global AGENT_MAX_TOOL_TURNS envelope (10)', () => {
    const budgets: AgentMode[] = ['anchor', 'analyst', 'fix-architect'];
    for (const mode of budgets) {
      expect(MODE_TOOL_BUDGET[mode]).toBeLessThanOrEqual(10);
    }
  });
});

describe('computeEffectiveMode', () => {
  describe('when lockedMode is null (AUTO)', () => {
    it('returns null for any message — caller defers to in-prompt auto-promotion', () => {
      expect(computeEffectiveMode({ lockedMode: null, userMessage: 'patch this CVE' })).toBeNull();
    });

    it('returns null even with critical+KEV signal', () => {
      expect(
        computeEffectiveMode({
          lockedMode: null,
          userMessage: '',
          signalSeverity: 'critical',
          signalIsKev: true,
        }),
      ).toBeNull();
    });

    it('returns null even with panel-click context', () => {
      expect(
        computeEffectiveMode({
          lockedMode: null,
          userMessage: '',
          panelContext: true,
        }),
      ).toBeNull();
    });
  });

  describe('when locked to anchor', () => {
    it('returns anchor for a routine message', () => {
      expect(
        computeEffectiveMode({
          lockedMode: 'anchor',
          userMessage: 'what is the latest CVE?',
        }),
      ).toBe('anchor');
    });

    it('returns anchor on empty message with no escalation triggers', () => {
      expect(computeEffectiveMode({ lockedMode: 'anchor', userMessage: '' })).toBe('anchor');
    });

    describe('Mode 2 escalation (analyst floor lift)', () => {
      it.each([
        ['deep dive', 'do a deep dive on Volt Typhoon'],
        ['tell me everything', 'tell me everything about the breach'],
        ['investigate', 'investigate this incident'],
        ['go deeper', 'go deeper on this'],
        ['TTPs', 'what TTPs does APT29 use?'],
        ['IOCs', 'show me the IOCs'],
      ])('escalates anchor → analyst on Mode 2 keyword "%s"', (_label, msg) => {
        expect(computeEffectiveMode({ lockedMode: 'anchor', userMessage: msg })).toBe('analyst');
      });

      it('matches Mode 2 keywords case-insensitively', () => {
        expect(
          computeEffectiveMode({ lockedMode: 'anchor', userMessage: 'DEEP DIVE on this' }),
        ).toBe('analyst');
      });

      it('escalates on panel-click context', () => {
        expect(
          computeEffectiveMode({
            lockedMode: 'anchor',
            userMessage: 'tell me about this',
            panelContext: true,
          }),
        ).toBe('analyst');
      });

      it('escalates on critical+KEV signal', () => {
        expect(
          computeEffectiveMode({
            lockedMode: 'anchor',
            userMessage: 'new alert',
            signalSeverity: 'critical',
            signalIsKev: true,
          }),
        ).toBe('analyst');
      });

      it('does NOT escalate on critical alone (KEV flag missing)', () => {
        expect(
          computeEffectiveMode({
            lockedMode: 'anchor',
            userMessage: 'new alert',
            signalSeverity: 'critical',
            signalIsKev: false,
          }),
        ).toBe('anchor');
      });

      it('does NOT escalate on high+KEV — critical is required', () => {
        expect(
          computeEffectiveMode({
            lockedMode: 'anchor',
            userMessage: 'new alert',
            signalSeverity: 'high',
            signalIsKev: true,
          }),
        ).toBe('anchor');
      });

      it('does NOT escalate on medium severity', () => {
        expect(
          computeEffectiveMode({
            lockedMode: 'anchor',
            userMessage: 'new alert',
            signalSeverity: 'medium',
            signalIsKev: true,
          }),
        ).toBe('anchor');
      });
    });

    describe('Mode 3 escalation (fix-architect ceiling lift)', () => {
      it.each([
        ['patch', 'what patch should I apply?'],
        ['fix', 'how do I fix this?'],
        ['mitigation', 'give me the mitigation'],
        ['workaround', 'what is the workaround?'],
        ['Sigma', 'write a Sigma rule'],
        ['YARA', 'create a YARA rule'],
        ['D3FEND', 'what D3FEND countermeasure applies?'],
        ['what do I do', 'what do I do about this'],
      ])('escalates anchor → fix-architect on Mode 3 keyword "%s"', (_label, msg) => {
        expect(computeEffectiveMode({ lockedMode: 'anchor', userMessage: msg })).toBe(
          'fix-architect',
        );
      });

      it('Mode 3 keyword takes priority when both Mode 2 and Mode 3 keywords are present', () => {
        expect(
          computeEffectiveMode({
            lockedMode: 'anchor',
            userMessage: 'deep dive on this and tell me what patch to apply',
          }),
        ).toBe('fix-architect');
      });

      it('Mode 3 keyword wins even against critical+KEV signal (remediation intent overrides analysis intent)', () => {
        expect(
          computeEffectiveMode({
            lockedMode: 'anchor',
            userMessage: 'how do I patch this?',
            signalSeverity: 'critical',
            signalIsKev: true,
          }),
        ).toBe('fix-architect');
      });
    });
  });

  describe('when locked to analyst', () => {
    it('returns analyst for a routine message', () => {
      expect(
        computeEffectiveMode({ lockedMode: 'analyst', userMessage: 'what is happening?' }),
      ).toBe('analyst');
    });

    it('does NOT down-grade to anchor on no-trigger message', () => {
      expect(computeEffectiveMode({ lockedMode: 'analyst', userMessage: 'hello' })).toBe('analyst');
    });

    it('does NOT down-grade when a Mode 2 keyword is present (already at the floor)', () => {
      expect(computeEffectiveMode({ lockedMode: 'analyst', userMessage: 'deep dive' })).toBe(
        'analyst',
      );
    });

    it('escalates UP to fix-architect on Mode 3 keyword', () => {
      expect(
        computeEffectiveMode({
          lockedMode: 'analyst',
          userMessage: 'what patch should I apply?',
        }),
      ).toBe('fix-architect');
    });

    it('stays at analyst on critical+KEV signal (already at the analyst floor)', () => {
      expect(
        computeEffectiveMode({
          lockedMode: 'analyst',
          userMessage: 'new alert',
          signalSeverity: 'critical',
          signalIsKev: true,
        }),
      ).toBe('analyst');
    });

    it('stays at analyst on panel-click context', () => {
      expect(
        computeEffectiveMode({
          lockedMode: 'analyst',
          userMessage: 'tell me about this',
          panelContext: true,
        }),
      ).toBe('analyst');
    });
  });

  describe('when locked to fix-architect', () => {
    it('returns fix-architect for any routine message (top of mode hierarchy)', () => {
      expect(computeEffectiveMode({ lockedMode: 'fix-architect', userMessage: 'hello' })).toBe(
        'fix-architect',
      );
    });

    it('does NOT down-grade on Mode 2 keyword', () => {
      expect(computeEffectiveMode({ lockedMode: 'fix-architect', userMessage: 'deep dive' })).toBe(
        'fix-architect',
      );
    });

    it('does NOT change on Mode 3 keyword (already at top)', () => {
      expect(computeEffectiveMode({ lockedMode: 'fix-architect', userMessage: 'patch this' })).toBe(
        'fix-architect',
      );
    });

    it('does NOT change on critical+KEV signal', () => {
      expect(
        computeEffectiveMode({
          lockedMode: 'fix-architect',
          userMessage: '',
          signalSeverity: 'critical',
          signalIsKev: true,
        }),
      ).toBe('fix-architect');
    });
  });

  describe('word-boundary keyword matching', () => {
    it('does not false-match "patch" inside "dispatched"', () => {
      expect(
        computeEffectiveMode({
          lockedMode: 'anchor',
          userMessage: 'reports were dispatched yesterday',
        }),
      ).toBe('anchor');
    });

    it('does match plural "patches"', () => {
      expect(
        computeEffectiveMode({ lockedMode: 'anchor', userMessage: 'show recent patches' }),
      ).toBe('fix-architect');
    });

    it('does match gerund "patching"', () => {
      expect(computeEffectiveMode({ lockedMode: 'anchor', userMessage: 'patching schedule' })).toBe(
        'fix-architect',
      );
    });

    it('does not false-match "fix" inside "fixative"', () => {
      expect(
        computeEffectiveMode({
          lockedMode: 'anchor',
          userMessage: 'the fixative compound is unrelated',
        }),
      ).toBe('anchor');
    });

    it('matches Mode 2 keyword as a whole phrase, not substring', () => {
      // "go deeper" should match; "deepen" alone should not
      expect(
        computeEffectiveMode({ lockedMode: 'anchor', userMessage: 'go deeper into this' }),
      ).toBe('analyst');
      expect(computeEffectiveMode({ lockedMode: 'anchor', userMessage: 'deepen the well' })).toBe(
        'anchor',
      );
    });
  });
});

describe('getModeAddendum', () => {
  it('returns empty string for null mode (no lock = no addendum)', () => {
    expect(getModeAddendum(null)).toBe('');
  });

  it('returns anchor addendum mentioning LOCKED + ANCHOR + BLUF discipline', () => {
    const text = getModeAddendum('anchor');
    expect(text).toContain('LOCKED');
    expect(text).toContain('ANCHOR');
    expect(text.toUpperCase()).toContain('BLUF');
  });

  it('returns analyst addendum mentioning LOCKED + ANALYST + SITREP discipline', () => {
    const text = getModeAddendum('analyst');
    expect(text).toContain('LOCKED');
    expect(text).toContain('ANALYST');
    expect(text.toUpperCase()).toContain('SITREP');
  });

  it('returns fix-architect addendum mentioning LOCKED + FIX ARCHITECT + playbook discipline', () => {
    const text = getModeAddendum('fix-architect');
    expect(text).toContain('LOCKED');
    expect(text).toContain('FIX ARCHITECT');
    expect(text.toLowerCase()).toContain('playbook');
  });

  it('addenda are non-trivial (at least 100 characters each — meaningful guidance, not a one-liner)', () => {
    expect(getModeAddendum('anchor').length).toBeGreaterThan(100);
    expect(getModeAddendum('analyst').length).toBeGreaterThan(100);
    expect(getModeAddendum('fix-architect').length).toBeGreaterThan(100);
  });
});

describe('extractModeMarker', () => {
  it('extracts anchor marker on its own line', () => {
    const result = extractModeMarker('[[MODE:anchor]]\nThe CVE is critical.');
    expect(result.mode).toBe('anchor');
    expect(result.stripped).toBe('The CVE is critical.');
  });

  it('extracts analyst marker on its own line', () => {
    const result = extractModeMarker('[[MODE:analyst]]\n## DATA SUMMARY');
    expect(result.mode).toBe('analyst');
    expect(result.stripped).toBe('## DATA SUMMARY');
  });

  it('extracts fix-architect marker on its own line', () => {
    const result = extractModeMarker('[[MODE:fix-architect]]\n**BLUF:** Patch now.');
    expect(result.mode).toBe('fix-architect');
    expect(result.stripped).toBe('**BLUF:** Patch now.');
  });

  it('extracts marker with no trailing newline (followed by content on same line)', () => {
    const result = extractModeMarker('[[MODE:analyst]] BLUF starts here');
    expect(result.mode).toBe('analyst');
    expect(result.stripped).toBe('BLUF starts here');
  });

  it('tolerates leading whitespace before the marker', () => {
    const result = extractModeMarker('   [[MODE:anchor]]\nText');
    expect(result.mode).toBe('anchor');
    expect(result.stripped).toBe('Text');
  });

  it('returns null mode + original text when no marker is present', () => {
    const result = extractModeMarker('Just a regular response with no marker.');
    expect(result.mode).toBeNull();
    expect(result.stripped).toBe('Just a regular response with no marker.');
  });

  it('returns null for a marker with an unknown mode value (defensive)', () => {
    const result = extractModeMarker('[[MODE:bogus]]\nText');
    expect(result.mode).toBeNull();
    expect(result.stripped).toBe('[[MODE:bogus]]\nText');
  });

  it('returns null mode for an empty input', () => {
    const result = extractModeMarker('');
    expect(result.mode).toBeNull();
    expect(result.stripped).toBe('');
  });

  it('only strips the FIRST marker — later [[MODE:...]] occurrences (if any) stay in the body', () => {
    const result = extractModeMarker(
      '[[MODE:anchor]]\nThe marker [[MODE:analyst]] appears again in body text.',
    );
    expect(result.mode).toBe('anchor');
    expect(result.stripped).toBe('The marker [[MODE:analyst]] appears again in body text.');
  });

  it('does not match a marker that is not at the start of the text', () => {
    const result = extractModeMarker('Some preamble. [[MODE:analyst]] then content.');
    expect(result.mode).toBeNull();
    expect(result.stripped).toBe('Some preamble. [[MODE:analyst]] then content.');
  });

  it('extracts CRLF-terminated markers (Windows-style line endings)', () => {
    const result = extractModeMarker('[[MODE:anchor]]\r\nText');
    expect(result.mode).toBe('anchor');
    expect(result.stripped).toBe('Text');
  });

  // Phase 14.5 hardening — code-review findings #9 + #14
  describe('regex tolerance for LLM formatting drift', () => {
    it('extracts case-variant uppercase mode: [[MODE:ANCHOR]]', () => {
      const result = extractModeMarker('[[MODE:ANCHOR]]\nText');
      expect(result.mode).toBe('anchor');
      expect(result.stripped).toBe('Text');
    });

    it('extracts mixed-case keyword: [[Mode:analyst]]', () => {
      const result = extractModeMarker('[[Mode:analyst]]\nText');
      expect(result.mode).toBe('analyst');
      expect(result.stripped).toBe('Text');
    });

    it('extracts a marker with whitespace after the colon: [[MODE: analyst]]', () => {
      const result = extractModeMarker('[[MODE: analyst]]\nText');
      expect(result.mode).toBe('analyst');
      expect(result.stripped).toBe('Text');
    });

    it('extracts a marker with whitespace inside brackets: [[ MODE : analyst ]]', () => {
      const result = extractModeMarker('[[ MODE : analyst ]]\nText');
      expect(result.mode).toBe('analyst');
      expect(result.stripped).toBe('Text');
    });

    it('extracts case-variant mode token: [[MODE:Fix-Architect]]', () => {
      const result = extractModeMarker('[[MODE:Fix-Architect]]\nText');
      expect(result.mode).toBe('fix-architect');
      expect(result.stripped).toBe('Text');
    });

    it('preserves blank lines and indentation in the response body (no greedy whitespace gobble)', () => {
      // Greedy `\s*` after the closing brackets would eat the blank line AND
      // the leading 4-space indent of the body, destroying Markdown structure.
      const result = extractModeMarker('[[MODE:fix-architect]]\n\n    1. Apply WAF rule:\n    ```');
      expect(result.mode).toBe('fix-architect');
      expect(result.stripped).toBe('\n    1. Apply WAF rule:\n    ```');
    });

    it('does not match markers in body position when no anchored marker exists', () => {
      const result = extractModeMarker('Some preamble. [[MODE:analyst]] then content.');
      expect(result.mode).toBeNull();
      expect(result.stripped).toBe('Some preamble. [[MODE:analyst]] then content.');
    });
  });
});

// Phase 14.5 hardening — code-review finding #4 + #5 + #6 + #11
describe('stripAllModeMarkers', () => {
  it('strips a marker at the start of the text', () => {
    expect(stripAllModeMarkers('[[MODE:anchor]]\nHello')).toBe('Hello');
  });

  it('strips an inline marker (no surrounding newlines) and collapses to a single space', () => {
    expect(stripAllModeMarkers('Preamble [[MODE:analyst]] body continues')).toBe(
      'Preamble body continues',
    );
  });

  it('strips a standalone-line marker and collapses to a single newline (preserves paragraph break)', () => {
    expect(stripAllModeMarkers('Preamble.\n[[MODE:analyst]]\nBody')).toBe('Preamble.\nBody');
  });

  it('strips a marker followed by a newline (treats as line-terminator)', () => {
    expect(stripAllModeMarkers('Preamble. [[MODE:analyst]]\nBody')).toBe('Preamble.\nBody');
  });

  it('strips multiple markers anywhere in the text', () => {
    expect(
      stripAllModeMarkers('[[MODE:anchor]]\nOne [[MODE:analyst]] and [[MODE:fix-architect]] more'),
    ).toBe('One and more');
  });

  it('returns text unchanged when no marker is present', () => {
    expect(stripAllModeMarkers('No marker here')).toBe('No marker here');
  });

  it('handles empty string', () => {
    expect(stripAllModeMarkers('')).toBe('');
  });

  it('strips case-variant and whitespace-tolerant markers', () => {
    expect(stripAllModeMarkers('Start. [[MODE: ANCHOR ]] end.')).toBe('Start. end.');
  });

  it('leaves unknown mode strings alone (defensive — only strips valid modes)', () => {
    // We do not strip `[[MODE:bogus]]` because that lets us surface format
    // drift to operators rather than silently swallowing it.
    expect(stripAllModeMarkers('Body has [[MODE:bogus]] in it')).toBe(
      'Body has [[MODE:bogus]] in it',
    );
  });

  it('collapses surrounding whitespace so the stripped span does not leave double spaces', () => {
    expect(stripAllModeMarkers('A [[MODE:anchor]] B')).toBe('A B');
    expect(stripAllModeMarkers('A\n[[MODE:anchor]]\nB')).toBe('A\nB');
  });
});

// Phase 14.5 hardening — code-review finding #2 + #10
describe('parseLockedMode', () => {
  it('accepts the three valid modes', () => {
    expect(parseLockedMode('anchor')).toBe('anchor');
    expect(parseLockedMode('analyst')).toBe('analyst');
    expect(parseLockedMode('fix-architect')).toBe('fix-architect');
  });

  it('returns null for null', () => {
    expect(parseLockedMode(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseLockedMode(undefined)).toBeNull();
  });

  it('returns null for an invalid string', () => {
    expect(parseLockedMode('foo')).toBeNull();
    expect(parseLockedMode('')).toBeNull();
    expect(parseLockedMode('ANCHOR')).toBeNull(); // case-sensitive on the wire format
  });

  it('returns null for non-string values', () => {
    expect(parseLockedMode(0)).toBeNull();
    expect(parseLockedMode(false)).toBeNull();
    expect(parseLockedMode({})).toBeNull();
    expect(parseLockedMode([])).toBeNull();
  });
});

// Phase 14.5 hardening — code-review finding #13
describe('MODE_LEVEL + isEscalation', () => {
  it('orders modes anchor < analyst < fix-architect', () => {
    expect(MODE_LEVEL.anchor).toBeLessThan(MODE_LEVEL.analyst);
    expect(MODE_LEVEL.analyst).toBeLessThan(MODE_LEVEL['fix-architect']);
  });

  it('is NOT an escalation when not locked', () => {
    expect(isEscalation(null, 'analyst')).toBe(false);
    expect(isEscalation(null, 'fix-architect')).toBe(false);
  });

  it('is NOT an escalation when detected matches locked', () => {
    expect(isEscalation('analyst', 'analyst')).toBe(false);
  });

  it('IS an escalation when detected level is above locked level', () => {
    expect(isEscalation('anchor', 'analyst')).toBe(true);
    expect(isEscalation('anchor', 'fix-architect')).toBe(true);
    expect(isEscalation('analyst', 'fix-architect')).toBe(true);
  });

  it('is NOT an escalation when detected level is BELOW locked level (down-grade)', () => {
    // A polluted or stale detectedMode below the lock floor must NOT
    // render as an upward escalation cue.
    expect(isEscalation('fix-architect', 'anchor')).toBe(false);
    expect(isEscalation('fix-architect', 'analyst')).toBe(false);
    expect(isEscalation('analyst', 'anchor')).toBe(false);
  });
});

// Phase 14.5 hardening — code-review finding #10 (default arm)
describe('getModeAddendum defensive default', () => {
  it('returns empty string for an invalid mode value coerced through', () => {
    // Cast required because the type signature is AgentMode | null — but the
    // bug we're guarding against is when an invalid value reaches the function
    // at runtime despite the type. The switch must have a default arm.
    const result = getModeAddendum('not-a-mode' as unknown as AgentMode);
    expect(result).toBe('');
  });
});

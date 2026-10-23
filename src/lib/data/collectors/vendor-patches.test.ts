/**
 * Tests for vendor release severity.
 *
 * Every live vendor feed defaulted to `high`, so a routine "Chrome Stable for
 * iOS Update" became a high-severity advisory → fired `patch.released` → wrote
 * an alert. The live board reached 16 alerts, all vendor release notes, and
 * they filled the top ticker.
 *
 * The floor is `medium` now, which means this promotion function is the ONLY
 * way a vendor item can alert at all — a false promotion puts the noise
 * straight back.
 */

import { describe, expect, it } from 'vitest';
import { inferSeverityFromTitle } from './vendor-patches';

const FLOOR = 'medium' as const;

describe('inferSeverityFromTitle (vendor)', () => {
  it('leaves the real-world release notes that flooded the board at the floor', () => {
    for (const title of [
      'Chrome Stable for iOS Update',
      'Chrome Beta for iOS Update',
      'Stable Channel Update for Desktop',
      'Long Term Support Channel Update for ChromeOS',
      'USN-8591-1: AIOHTTP vulnerabilities',
      'USN-8590-1: Exim vulnerabilities',
    ]) {
      expect(inferSeverityFromTitle(title, FLOOR), title).toBe('medium');
    }
  });

  it('still promotes a title that carries a real rating', () => {
    expect(inferSeverityFromTitle('Critical security update for Chrome', FLOOR)).toBe('critical');
    expect(inferSeverityFromTitle('Important update for Red Hat Enterprise Linux', FLOOR)).toBe(
      'high',
    );
    expect(inferSeverityFromTitle('USN-1234-1: High severity kernel fix', FLOOR)).toBe('high');
  });

  it('requires word boundaries so a substring cannot promote a release', () => {
    // The trap the CERT collector had: "highlights" reading as `high`.
    expect(inferSeverityFromTitle('Release highlights for Chrome 140', FLOOR)).toBe('medium');
    expect(inferSeverityFromTitle('Improved data flow in the renderer', FLOOR)).toBe('medium');
    expect(inferSeverityFromTitle('Criticality review process update', FLOOR)).toBe('medium');
  });

  it('honours an explicit low or moderate rating', () => {
    expect(inferSeverityFromTitle('Low severity fix in libfoo', FLOOR)).toBe('low');
    expect(inferSeverityFromTitle('Moderate: input validation issue', FLOOR)).toBe('medium');
  });

  it('falls back to the floor for an absent title', () => {
    expect(inferSeverityFromTitle(undefined, FLOOR)).toBe('medium');
    expect(inferSeverityFromTitle('')).toBe('medium');
  });
});

describe('the alerting consequence', () => {
  it('a routine release now sits below the critical|high bar that patch.released requires', async () => {
    const { EVENT_TRIGGERS } = await import('@/lib/agent/activation');
    const severity = inferSeverityFromTitle('Chrome Stable for iOS Update', FLOOR);

    // This is the whole point of the floor change — assert the linkage, not
    // just the severity value, so moving one without the other fails here.
    expect(severity).toBe('medium');
    expect(EVENT_TRIGGERS['patch.released']?.({ severity })).toBeNull();
  });

  it('a genuinely critical vendor advisory still alerts', async () => {
    const { EVENT_TRIGGERS } = await import('@/lib/agent/activation');
    const severity = inferSeverityFromTitle('Critical security update for Chrome', FLOOR);

    expect(severity).toBe('critical');
    expect(EVENT_TRIGGERS['patch.released']?.({ severity })).not.toBeNull();
  });
});

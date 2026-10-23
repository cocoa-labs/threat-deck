import { describe, expect, it } from 'vitest';
import { composeRssBlurb, pickAlertWireTake, pickWireTakeaway } from './index';

// pickWireTakeaway was lifted verbatim from DailyDigest.tsx. These cases lock
// the exact count-shape → string mapping so the relocation is provably
// behavior-preserving.
describe('pickWireTakeaway (parity with the prior DailyDigest logic)', () => {
  it('returns null on an empty day', () => {
    expect(pickWireTakeaway({ cveCount: 0, kevCount: 0, breachCount: 0 })).toBeNull();
  });
  it('high-density days (>=5 items) get the recurring-failure coda', () => {
    expect(pickWireTakeaway({ cveCount: 5, kevCount: 0, breachCount: 0 })).toBe(
      'We are nothing if not consistent.',
    );
  });
  it('two-plus breaches get the drinking-game line', () => {
    expect(pickWireTakeaway({ cveCount: 0, kevCount: 0, breachCount: 2 })).toBe(
      'The infosec drinking game continues.',
    );
  });
  it('two-plus KEV adds get patch-and-pray', () => {
    expect(pickWireTakeaway({ cveCount: 0, kevCount: 2, breachCount: 0 })).toBe('Patch and pray.');
  });
  it('three-plus CVEs with no KEV add get the I-told-you-so', () => {
    expect(pickWireTakeaway({ cveCount: 3, kevCount: 0, breachCount: 0 })).toBe(
      'Predictable in retrospect.',
    );
  });
  it('a KEV add paired with a breach reads as an industry pattern', () => {
    expect(pickWireTakeaway({ cveCount: 0, kevCount: 1, breachCount: 1 })).toBe(
      'Same playbook, different vendor.',
    );
  });
  it('a lone KEV add gets the catalog cadence', () => {
    expect(pickWireTakeaway({ cveCount: 0, kevCount: 1, breachCount: 0 })).toBe(
      'The catalog wakes up.',
    );
  });
  it('a lone CVE gets the default mid-density observation', () => {
    expect(pickWireTakeaway({ cveCount: 1, kevCount: 0, breachCount: 0 })).toBe(
      'Less surprising than it should be.',
    );
  });
});

// pickAlertWireTake: one deterministic voiced line for a per-alert email,
// keyed off facts the alert route already loads. NO LLM. Returns null when no
// clear pattern fits — no forced wit.
describe('pickAlertWireTake', () => {
  it('an overdue KEV deadline echoes the deadline-passed beat', () => {
    expect(pickAlertWireTake({ kind: 'kev', overdue: true })).toBe('The deadline came and went.');
  });
  it('actively exploited CVEs note that exploitation is not theoretical', () => {
    expect(pickAlertWireTake({ kind: 'cve', exploitedInWild: true })).toBe(
      'Exploitation is not theoretical.',
    );
  });
  it('a KEV-listed CVE (not yet overdue) gets the catalog cadence', () => {
    expect(pickAlertWireTake({ kind: 'cve', isKev: true })).toBe('The catalog wakes up.');
  });
  it('a ransomware breach reads as a recurring industry pattern', () => {
    expect(pickAlertWireTake({ kind: 'breach', knownRansomware: true })).toBe(
      'Same playbook, different vendor.',
    );
  });
  it('a seven-figure breach gets the drinking-game line', () => {
    expect(pickAlertWireTake({ kind: 'breach', recordsCompromised: 4_200_000 })).toBe(
      'The infosec drinking game continues.',
    );
  });
  it('returns null when no clear pattern fits (no forced wit)', () => {
    expect(pickAlertWireTake({ kind: 'cve' })).toBeNull();
  });
});

// composeRssBlurb: voice the RSS item description from the row's own fields,
// deterministically (no LLM — safe for the 50-item ISR rebuild). The lead item
// carries an atmospheric frame; later items stay closer to the bare summary.
describe('composeRssBlurb', () => {
  const row = {
    severity: 'critical',
    alertType: 'cve',
    summary: 'CVE-2026-42208 lets an unauthenticated attacker read the database.',
    headline: 'LiteLLM SQL injection',
  };
  it('prefixes a voiced frame onto the lead item, preserving the facts', () => {
    const out = composeRssBlurb(row, { lead: true });
    expect(out.endsWith(row.summary)).toBe(true);
    expect(out.length).toBeGreaterThan(row.summary.length);
  });
  it('leaves non-lead items as the bare factual summary', () => {
    expect(composeRssBlurb(row, { lead: false })).toBe(row.summary);
  });
  it('falls back to the headline when a row has no summary', () => {
    expect(composeRssBlurb({ ...row, summary: null }, { lead: false })).toBe(row.headline);
  });
});

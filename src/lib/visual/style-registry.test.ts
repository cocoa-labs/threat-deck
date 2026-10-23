import { describe, expect, it } from 'vitest';
import { resolveStyleTag, STYLE_REGISTRY, type StyleTag } from './style-registry';

describe('STYLE_REGISTRY', () => {
  it('contains the curated topic-aware styles', () => {
    expect(Object.keys(STYLE_REGISTRY).sort()).toEqual([
      'crt_terminal',
      'exposure_ledger',
      'identity_intrusion',
      'kev_pressure',
      'market_signal_board',
      'research_gap_card',
      'supply_chain_map',
    ]);
  });

  it.each([
    'kev_pressure',
    'identity_intrusion',
    'supply_chain_map',
    'research_gap_card',
    'exposure_ledger',
    'market_signal_board',
    'crt_terminal',
  ] as StyleTag[])(
    'style %s has a non-empty backdrop prompt template with text-suppression directive',
    (tag) => {
      const def = STYLE_REGISTRY[tag];
      expect(def.backdropPromptTemplate).toBeTruthy();
      expect(def.backdropPromptTemplate.toLowerCase()).toMatch(/no text|no letters|no words/);
    },
  );

  it.each([
    'kev_pressure',
    'identity_intrusion',
    'supply_chain_map',
    'research_gap_card',
    'exposure_ledger',
    'market_signal_board',
    'crt_terminal',
  ] as StyleTag[])('style %s has a valid 3-color palette', (tag) => {
    const def = STYLE_REGISTRY[tag];
    expect(def.palette.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(def.palette.secondary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(def.palette.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('resolveStyleTag', () => {
  it('returns the explicit override when provided', () => {
    expect(resolveStyleTag('cve', 'identity_intrusion')).toBe('identity_intrusion');
    expect(resolveStyleTag(undefined, 'market_signal_board')).toBe('market_signal_board');
  });

  it('maps kev → kev_pressure', () => {
    expect(resolveStyleTag('kev')).toBe('kev_pressure');
  });

  it('maps cve_critical → kev_pressure', () => {
    expect(resolveStyleTag('cve_critical')).toBe('kev_pressure');
  });

  it('maps threat_actor → identity_intrusion', () => {
    expect(resolveStyleTag('threat_actor')).toBe('identity_intrusion');
  });

  it('maps forecast → market_signal_board', () => {
    expect(resolveStyleTag('forecast')).toBe('market_signal_board');
  });

  it('maps predictions → market_signal_board', () => {
    expect(resolveStyleTag('predictions')).toBe('market_signal_board');
  });

  it('falls back to crt_terminal for unknown entityKind', () => {
    expect(resolveStyleTag('some_unknown_kind')).toBe('crt_terminal');
  });

  it('falls back to crt_terminal when entityKind is undefined', () => {
    expect(resolveStyleTag(undefined)).toBe('crt_terminal');
  });

  it('ignores invalid override and uses entityKind routing', () => {
    expect(resolveStyleTag('kev', 'not_a_real_style' as StyleTag)).toBe('kev_pressure');
  });
});

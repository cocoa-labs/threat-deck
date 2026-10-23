import { describe, expect, it } from 'vitest';
import { buildModelRenderedInfographicPrompt } from './infographic-prompt';
import { STYLE_TAGS, type StyleTag } from './style-registry';
import type { VisualBrief } from './visual-brief';

const BASE_BRIEF: VisualBrief = {
  schemaVersion: 'visual-v2',
  title: 'GlassWorm Botnet Takedown',
  bluf: 'A package-registry campaign was disrupted after compromising developer tooling.',
  severity: 'high',
  entityKind: 'supply_chain',
  metrics: [
    { label: 'Packages', value: '72+' },
    { label: 'Channels', value: '4' },
  ],
  sections: [
    {
      label: 'Operator Takeaway',
      body: 'The registry is the blast-radius surface, not just the package.',
    },
  ],
  timeline: [{ label: 'Takedown', value: '2026-05-26' }],
  sources: [{ name: 'CrowdStrike', url: 'https://www.crowdstrike.com/blog', tier: 'VERIFIED' }],
  themeHints: ['package', 'registry', 'botnet'],
};

const EXPECTED_DIRECTIVES: Record<StyleTag, string> = {
  kev_pressure: 'exploit-window poster',
  identity_intrusion: 'account-plane investigation board',
  supply_chain_map: 'dependency topology board',
  research_gap_card: 'belief-versus-reality split',
  exposure_ledger: 'breach register',
  market_signal_board: 'probability and market dashboard',
  crt_terminal: 'Fallback CRT terminal layout',
};

describe('buildModelRenderedInfographicPrompt', () => {
  it.each(STYLE_TAGS)('adds a distinct %s composition directive', (styleTag) => {
    const prompt = buildModelRenderedInfographicPrompt(BASE_BRIEF, styleTag);

    expect(prompt).toContain(EXPECTED_DIRECTIVES[styleTag]);
    expect(prompt).toContain('Do not invent facts');
    expect(prompt).toContain('source footer');
    expect(prompt).toContain('Do not use generic cyber stock art');
  });
});

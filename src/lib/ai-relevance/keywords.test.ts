/**
 * Pure unit tests for the keyword baseline. No DB, no LLM, no I/O — the
 * scoring should be 100% deterministic for a given input. If these tests
 * pass, the keyword tier holds rule #20 (no warnings) and the scorer
 * orchestrator can build on it confidently.
 */

import { describe, expect, it } from 'vitest';
import { scoreByKeywords } from './keywords';

describe('keywords — STRONG_TERMS lock to confident_yes', () => {
  it('locks WormGPT to offensive at 0.9', () => {
    const r = scoreByKeywords({ title: 'WormGPT clone resurfaces on dark web' });
    expect(r.score).toBe(0.9);
    expect(r.category).toBe('offensive');
    expect(r.band).toBe('confident_yes');
    expect(r.evidence.strong).toContain('WormGPT');
  });

  it('locks prompt injection to defensive', () => {
    const r = scoreByKeywords({
      title: 'New prompt injection technique bypasses Anthropic guardrails',
    });
    expect(r.score).toBe(0.9);
    expect(r.category).toBe('defensive');
    expect(r.band).toBe('confident_yes');
  });

  it('locks MITRE ATLAS to defensive', () => {
    const r = scoreByKeywords({
      title: 'MITRE ATLAS adds three new techniques for adversarial ML',
    });
    expect(r.score).toBe(0.9);
    expect(r.category).toBe('defensive');
  });

  it('locks MCP server exploit to agentic_safety', () => {
    const r = scoreByKeywords({ title: 'Critical MCP server exploit chain disclosed' });
    expect(r.score).toBe(0.9);
    expect(r.category).toBe('agentic_safety');
  });

  it('locks OWASP LLM Top 10 to defensive', () => {
    const r = scoreByKeywords({
      title: 'OWASP LLM Top 10 v2 published with prompt injection at #1',
    });
    expect(r.score).toBe(0.9);
    expect(r.category).toBe('defensive');
  });
});

describe('keywords — multi-subcategory crossing → 0.85', () => {
  it('crosses vendor_incident + defensive → confident_yes', () => {
    // "OpenAI breach" hits vendor_incident; "guardrail" hits defensive
    const r = scoreByKeywords({
      title: 'OpenAI breach exposes guardrail bypass dataset',
      summary: 'Internal red-team data leaked from OpenAI security incident.',
    });
    expect(r.score).toBe(0.85);
    expect(r.band).toBe('confident_yes');
  });

  it('crosses offensive + defensive → confident_yes', () => {
    const r = scoreByKeywords({
      title: 'AI-generated phishing campaigns now defeating LLM firewall guardrails',
    });
    expect(r.score).toBe(0.85);
    expect(r.band).toBe('confident_yes');
  });
});

describe('keywords — single subcategory → gray zone 0.55', () => {
  it('one vendor_incident hit alone → gray', () => {
    const r = scoreByKeywords({
      title: 'Lakera announces new funding round',
    });
    expect(r.band).toBe('gray');
    expect(r.score).toBeGreaterThanOrEqual(0.5);
    expect(r.score).toBeLessThan(0.7);
    expect(r.category).toBe('vendor_incident');
  });

  it('one defensive bank hit → gray', () => {
    const r = scoreByKeywords({
      title: 'New AI red teaming methodology proposed',
    });
    expect(r.band).toBe('gray');
    expect(r.category).toBe('defensive');
  });
});

describe('keywords — zero positive signals', () => {
  it('confident_no when negative term hits and no positives', () => {
    const r = scoreByKeywords({
      title: 'Tesla quarterly earnings beat expectations',
      summary: 'Stock price surged in after-hours trading.',
    });
    expect(r.score).toBe(0.05);
    expect(r.band).toBe('confident_no');
    expect(r.category).toBe('unrelated');
    expect(r.evidence.negative.length).toBeGreaterThan(0);
  });

  it('low band (0.20) when nothing matches at all', () => {
    const r = scoreByKeywords({
      title: 'Bakery opens in downtown Portland',
    });
    expect(r.score).toBe(0.2);
    expect(r.band).toBe('low');
    expect(r.category).toBe('unrelated');
  });
});

describe('keywords — positive signal overrides negative', () => {
  it('AI-cyber story does not get demoted by IPO mention', () => {
    const r = scoreByKeywords({
      title: 'WormGPT operator arrested after IPO of associated firm',
      summary: 'Stock price of parent company fell.',
    });
    // STRONG hit wins; negative is ignored
    expect(r.score).toBe(0.9);
    expect(r.category).toBe('offensive');
  });
});

describe('keywords — output is deterministic', () => {
  it('returns the same result for the same input', () => {
    const input = { title: 'WormGPT clone targets fintech', summary: 'Threat analysis follows.' };
    const a = scoreByKeywords(input);
    const b = scoreByKeywords(input);
    expect(a).toEqual(b);
  });

  it('case-insensitive: "wormgpt" matches the same as "WormGPT"', () => {
    const a = scoreByKeywords({ title: 'wormgpt resurfaces' });
    const b = scoreByKeywords({ title: 'WormGPT resurfaces' });
    expect(a.score).toBe(b.score);
    expect(a.category).toBe(b.category);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...a: unknown[]) => mockCreate(...a) };
  },
}));

import { generateDigestProse } from './digest-prose';

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

// 1 CVE + 1 KEV + 0 breach → pickWireTakeaway returns 'The catalog wakes up.'
const sampleInput = {
  dateLabel: 'Wednesday, May 28, 2026',
  cves: [{ cveId: 'CVE-2026-42208', severity: 'critical', vendor: 'LiteLLM', isKev: true }],
  kevAdds: [{ cveId: 'CVE-2026-42208', vulnerabilityName: 'SQLi' }],
  breaches: [],
};

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

beforeEach(() => {
  mockCreate.mockReset();
});
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe('generateDigestProse', () => {
  it('falls back to a deterministic takeaway when no API key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateDigestProse(sampleInput);
    expect(r.hero).toBe('');
    expect(r.takeaway).toBe('The catalog wakes up.');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns the LLM hero + takeaway on success', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(
      textResponse('{"hero":"The catalog wakes up before dawn.","takeaway":"Patch and pray."}'),
    );
    const r = await generateDigestProse(sampleInput);
    expect(r.hero).toBe('The catalog wakes up before dawn.');
    expect(r.takeaway).toBe('Patch and pray.');
  });

  it('falls back when the LLM call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockRejectedValueOnce(new Error('503'));
    const r = await generateDigestProse(sampleInput);
    expect(r.hero).toBe('');
    expect(r.takeaway).toBe('The catalog wakes up.');
  });

  it('falls back when the LLM returns unparseable JSON', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(textResponse('not json at all'));
    const r = await generateDigestProse(sampleInput);
    expect(r.hero).toBe('');
    expect(r.takeaway).toBe('The catalog wakes up.');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn(
    class MockOpenAI {
      images = { generate: mockGenerate };
    },
  ),
}));

import { OpenAIImageProvider } from './openai-image';
import { ProviderApiError, ProviderRateLimitError } from './types';

describe('OpenAIImageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });

  it('returns a structured ImageGenerationResult on success', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockGenerate.mockResolvedValueOnce({
      data: [{ b64_json: pngBytes.toString('base64') }],
      created: 1716663600,
      usage: { input_tokens: 350, output_tokens: 4096 },
    });

    const provider = new OpenAIImageProvider();
    const result = await provider.generate({
      prompt: 'Exploit pressure backdrop, no text',
      styleTag: 'kev_pressure',
      width: 1200,
      height: 2400,
      quality: 'high',
    });

    expect(result.provider).toBe('openai_gpt_image_2');
    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.length).toBe(pngBytes.length);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(2400);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('appends the standard negative prompt to user prompts', async () => {
    mockGenerate.mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from([0]).toString('base64') }],
      usage: { input_tokens: 10, output_tokens: 100 },
    });

    const provider = new OpenAIImageProvider();
    await provider.generate({
      prompt: 'Atmospheric scene',
      styleTag: 'kev_pressure',
    });

    const callArgs = mockGenerate.mock.calls[0]![0];
    expect(callArgs.prompt).toContain('Atmospheric scene');
    expect(callArgs.prompt.toLowerCase()).toMatch(/no text|no letters|no words/);
  });

  it('uses custom negative prompt when provided', async () => {
    mockGenerate.mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from([0]).toString('base64') }],
      usage: { input_tokens: 10, output_tokens: 100 },
    });

    const provider = new OpenAIImageProvider();
    await provider.generate({
      prompt: 'X',
      styleTag: 'y',
      negativePrompt: 'no humans',
    });

    const callArgs = mockGenerate.mock.calls[0]![0];
    expect(callArgs.prompt).toContain('no humans');
  });

  it('does not append no-text negative prompt when allowText is true', async () => {
    mockGenerate.mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from([0]).toString('base64') }],
      usage: { input_tokens: 10, output_tokens: 100 },
    });

    const provider = new OpenAIImageProvider();
    await provider.generate({
      prompt: 'Render a dense Cocoa AI infographic with exact labels',
      styleTag: 'crt_terminal',
      allowText: true,
    });

    const callArgs = mockGenerate.mock.calls[0]![0];
    expect(callArgs.prompt).toContain('Render a dense Cocoa AI infographic');
    expect(callArgs.prompt.toLowerCase()).not.toContain('no text in image');
  });

  it('throws ProviderRateLimitError on 429', async () => {
    mockGenerate.mockRejectedValueOnce({
      status: 429,
      message: 'Rate limit exceeded',
      headers: { 'retry-after-ms': '3000' },
    });

    const provider = new OpenAIImageProvider();
    await expect(provider.generate({ prompt: 'x', styleTag: 'y' })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
  });

  it('throws ProviderApiError on non-429 API failure', async () => {
    mockGenerate.mockRejectedValueOnce({
      status: 500,
      message: 'Internal error',
    });

    const provider = new OpenAIImageProvider();
    await expect(provider.generate({ prompt: 'x', styleTag: 'y' })).rejects.toBeInstanceOf(
      ProviderApiError,
    );
  });

  it('throws if OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIImageProvider()).toThrow(/OPENAI_API_KEY/);
  });

  it('computes cost from token usage', async () => {
    mockGenerate.mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from([0]).toString('base64') }],
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    });

    const provider = new OpenAIImageProvider();
    const result = await provider.generate({ prompt: 'x', styleTag: 'y' });

    // $8/M input + $30/M output → exactly $38
    expect(result.costUsd).toBeCloseTo(38, 1);
  });
});

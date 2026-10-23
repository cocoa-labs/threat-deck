/**
 * Integration tests for generateInfographic.
 *
 * All external dependencies are mocked:
 *   - OpenAIImageProvider.generate
 *   - uploadVisualBlob
 *   - query (DB)
 *   - recordAudit
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/visual/providers/openai-image', () => ({
  OpenAIImageProvider: vi.fn(
    class MockProvider {
      generate = vi.fn();
    },
  ),
}));

vi.mock('@/lib/storage/vercel-blob', () => ({
  uploadVisualBlob: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
}));

vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>();
  return {
    ...actual,
    recordAudit: vi.fn(),
  };
});

import { recordAudit } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { uploadVisualBlob } from '@/lib/storage/vercel-blob';
import { OpenAIImageProvider } from '@/lib/visual/providers/openai-image';
import { ProviderApiError } from '@/lib/visual/providers/types';
import type { GenerateInfographicRequest } from './orchestrator';
import { generateInfographic } from './orchestrator';

const FAKE_FINAL = Buffer.from('final-model-rendered-infographic-png'.repeat(80));

const BASE_REQUEST: GenerateInfographicRequest = {
  generatedMediaId: 'media-uuid-001',
  styleTag: 'kev_pressure',
  visualBrief: {
    schemaVersion: 'visual-v2',
    title: 'CVE-2024-1337 KEV Intelligence Brief',
    bluf: 'CISA adds CVE-2024-1337 to KEV catalog.',
    severity: 'critical',
    entityKind: 'kev',
    entityId: 'CVE-2024-1337',
    metrics: [{ label: 'CVSS', value: '9.8' }],
    sections: [{ label: 'Key Finding', body: 'Exploit pressure is elevated.' }],
    timeline: [],
    sources: [{ name: 'CISA KEV', url: 'https://cisa.gov/kev', tier: 'VERIFIED' }],
    themeHints: ['kev', 'exploit'],
  },
  sourceContext: null,
  entityKind: 'kev',
  entityId: 'CVE-2024-1337',
  severity: 'critical',
  generatedAt: '2026-05-26T00:00:00.000Z',
};

function getProviderMock() {
  const Ctor = vi.mocked(OpenAIImageProvider);
  return Ctor.mock.results[0]?.value as { generate: ReturnType<typeof vi.fn> };
}

describe('generateInfographic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';

    vi.mocked(uploadVisualBlob).mockResolvedValue({
      url: 'https://blob.vercel-storage.com/outbound-visuals/kev_pressure/media-uuid-001.png',
      pathname: 'outbound-visuals/kev_pressure/media-uuid-001.png',
      contentType: 'image/png',
      size: FAKE_FINAL.length,
    });
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
    vi.mocked(recordAudit).mockResolvedValue(undefined);
  });

  it('generates a model-rendered infographic, uploads it, updates DB, and audits', async () => {
    vi.mocked(OpenAIImageProvider).mockImplementationOnce(
      class MockProvider {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: Vitest constructor stub returns a provider fake
          return {
            generate: vi.fn().mockResolvedValue({
              buffer: FAKE_FINAL,
              mimeType: 'image/png',
              provider: 'openai_gpt_image_2',
              modelVersion: 'gpt-image-2-2026-04-21',
              costUsd: 0.04,
              durationMs: 1800,
              width: 1200,
              height: 2400,
            }),
            providerId: 'openai_gpt_image_2',
          } as unknown as InstanceType<typeof OpenAIImageProvider>;
        }
      } as never,
    );

    await generateInfographic(BASE_REQUEST);

    const providerInstance = getProviderMock();
    expect(providerInstance.generate).toHaveBeenCalledOnce();
    const generateCall = providerInstance.generate.mock.calls[0]?.[0];
    expect(generateCall).toMatchObject({
      width: 1200,
      height: 2400,
      quality: 'high',
      styleTag: 'kev_pressure',
      allowText: true,
    });
    expect(generateCall.prompt).toContain('CONTENT BRIEF');
    expect(generateCall.prompt).toContain('CVE-2024-1337');
    expect(generateCall.prompt).toContain('The image itself must contain the text');

    expect(uploadVisualBlob).toHaveBeenCalledOnce();
    const [blobPath, blobData, blobOpts] = vi.mocked(uploadVisualBlob).mock.calls[0] ?? [];
    expect(blobPath).toBe('outbound-visuals/kev_pressure/media-uuid-001.png');
    expect(blobData).toBe(FAKE_FINAL);
    expect(blobOpts).toMatchObject({ contentType: 'image/png' });

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = vi.mocked(query).mock.calls[0] ?? [];
    expect(String(sql).toLowerCase()).toContain('update');
    expect(String(sql).toLowerCase()).toContain("'ready'");
    expect(String(sql)).toContain('visual_payload');
    expect(params).toContain('visual-v2');
    expect(params).toContain('media-uuid-001');

    expect(recordAudit).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(recordAudit).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('outbound.visual_generated');
    expect(auditCall?.outcome).toBe('success');
  });

  it('retries safety rejections with a softened public-source infographic prompt', async () => {
    const safetyRequest: GenerateInfographicRequest = {
      ...BASE_REQUEST,
      styleTag: 'crt_terminal',
      severity: 'medium',
      visualBrief: {
        ...BASE_REQUEST.visualBrief,
        title: 'SITREP - GCHQ/MI6 Russia Threat Warning | May 26, 2026',
        bluf: 'GCHQ and MI6 intelligence indicates elevated Russia threat monitoring.',
        severity: 'medium',
        metrics: [
          { label: 'Markers', value: '6' },
          { label: 'Sources', value: '4' },
        ],
        sections: [
          {
            label: 'Key Finding',
            body: 'Intelligence markers are oriented around possible threat activity.',
          },
          {
            label: 'Risk Assessment',
            body: 'Operational posture should remain alert without panic.',
          },
        ],
        sources: [
          { name: 'GCHQ', url: 'https://www.gchq.gov.uk/', tier: 'VERIFIED' },
          { name: 'MI6', url: 'https://www.sis.gov.uk/', tier: 'VERIFIED' },
        ],
      },
    };
    const generate = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderApiError(
          'openai_gpt_image_2',
          400,
          'Your request was rejected by the safety system',
        ),
      )
      .mockResolvedValueOnce({
        buffer: FAKE_FINAL,
        mimeType: 'image/png',
        provider: 'openai_gpt_image_2',
        modelVersion: 'gpt-image-2-2026-04-21',
        costUsd: 0.04,
        durationMs: 2200,
        width: 1200,
        height: 2400,
      });
    vi.mocked(OpenAIImageProvider).mockImplementationOnce(
      class MockProvider {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: Vitest constructor stub returns a provider fake
          return {
            generate,
            providerId: 'openai_gpt_image_2',
          } as unknown as InstanceType<typeof OpenAIImageProvider>;
        }
      } as never,
    );

    await generateInfographic(safetyRequest);

    expect(generate).toHaveBeenCalledTimes(2);
    const firstPrompt = generate.mock.calls[0]?.[0].prompt;
    const secondPrompt = generate.mock.calls[1]?.[0].prompt;
    expect(firstPrompt).toContain('GCHQ/MI6');
    expect(secondPrompt).toContain('SANITIZED CONTENT BRIEF');
    expect(secondPrompt).toContain('UK security sources');
    expect(secondPrompt).not.toContain('GCHQ/MI6');

    const [, params] = vi.mocked(query).mock.calls[0] ?? [];
    expect(params).toContain('visual-v2');
    expect(params).toContain('media-uuid-001');
    expect(params).toContain(secondPrompt);

    const auditCall = vi.mocked(recordAudit).mock.calls[0]?.[0];
    expect(auditCall?.outcome).toBe('success');
    expect(auditCall?.details).toMatchObject({ safetyRetry: true });
  });

  it('marks the row failed when the provider throws', async () => {
    const providerError = new Error('gpt-image-2 API unavailable');
    vi.mocked(OpenAIImageProvider).mockImplementationOnce(
      class MockProvider {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: Vitest constructor stub returns a provider fake
          return {
            generate: vi.fn().mockRejectedValue(providerError),
            providerId: 'openai_gpt_image_2',
          } as unknown as InstanceType<typeof OpenAIImageProvider>;
        }
      } as never,
    );

    await expect(generateInfographic(BASE_REQUEST)).rejects.toThrow('gpt-image-2 API unavailable');

    expect(uploadVisualBlob).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = vi.mocked(query).mock.calls[0] ?? [];
    expect(String(sql).toLowerCase()).toContain('update');
    expect(String(sql).toLowerCase()).toContain("'failed'");
    expect(params).toContain('media-uuid-001');

    expect(recordAudit).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(recordAudit).mock.calls[0]?.[0];
    expect(auditCall?.action).toBe('outbound.visual_failed');
    expect(auditCall?.outcome).toBe('failure');
    expect(auditCall?.errorMessage).toContain('gpt-image-2 API unavailable');
  });

  it('selects the requested infographic template in the prompt and blob path', async () => {
    const noirRequest: GenerateInfographicRequest = {
      ...BASE_REQUEST,
      styleTag: 'identity_intrusion',
      entityKind: 'threat_actor',
      entityId: 'APT29',
      visualBrief: {
        ...BASE_REQUEST.visualBrief,
        title: 'APT29 Threat Actor Dossier',
        entityKind: 'threat_actor',
        entityId: 'APT29',
      },
    };

    vi.mocked(OpenAIImageProvider).mockImplementationOnce(
      class MockProvider {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: Vitest constructor stub returns a provider fake
          return {
            generate: vi.fn().mockResolvedValue({
              buffer: FAKE_FINAL,
              mimeType: 'image/png',
              provider: 'openai_gpt_image_2',
              modelVersion: 'gpt-image-2-2026-04-21',
              costUsd: 0.04,
              durationMs: 1500,
              width: 1200,
              height: 2400,
            }),
            providerId: 'openai_gpt_image_2',
          } as unknown as InstanceType<typeof OpenAIImageProvider>;
        }
      } as never,
    );

    await generateInfographic(noirRequest);

    const providerInstance = getProviderMock();
    const generateCall = providerInstance.generate.mock.calls[0]?.[0];
    expect(generateCall.prompt).toContain('Identity intrusion layout');
    expect(generateCall.prompt).toContain('APT29');
    expect(generateCall.allowText).toBe(true);

    const [blobPath] = vi.mocked(uploadVisualBlob).mock.calls[0] ?? [];
    expect(blobPath).toContain('identity_intrusion');
  });
});

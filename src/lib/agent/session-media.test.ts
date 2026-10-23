/**
 * Tests for the session-media manifest builder + route-boundary sanitizer.
 *
 * These guard the fix for "Max doesn't know about media generated earlier this
 * session" — the manifest is the only channel that carries generated-media
 * awareness (tool- OR IMG/VID-button-created) into the agent's context.
 */
import { describe, expect, it } from 'vitest';
import type { GeneratedImageAttachment, GeneratedVideoAttachment } from '@/lib/store/agent-store';
import {
  buildSessionMediaManifest,
  SESSION_MEDIA_LIMIT,
  sanitizeSessionMedia,
} from './session-media';

function img(over: Partial<GeneratedImageAttachment>): GeneratedImageAttachment {
  return { generatedMediaId: '1', createdAt: 1000, ...over };
}
function vid(over: Partial<GeneratedVideoAttachment>): GeneratedVideoAttachment {
  return { generatedMediaId: '1', createdAt: 1000, ...over };
}

describe('buildSessionMediaManifest', () => {
  it('returns [] when there is no media', () => {
    expect(buildSessionMediaManifest([])).toEqual([]);
    expect(buildSessionMediaManifest([{ generatedImages: [], generatedVideos: [] }])).toEqual([]);
  });

  it('flattens images and videos across messages, tagging kind', () => {
    const result = buildSessionMediaManifest([
      { generatedImages: [img({ generatedMediaId: '10', createdAt: 1 })] },
      { generatedVideos: [vid({ generatedMediaId: '20', createdAt: 2 })] },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.generatedMediaId === '10')?.kind).toBe('image');
    expect(result.find((m) => m.generatedMediaId === '20')?.kind).toBe('video');
  });

  it('drops failed media', () => {
    const result = buildSessionMediaManifest([
      { generatedImages: [img({ generatedMediaId: '10', status: 'failed' })] },
    ]);
    expect(result).toEqual([]);
  });

  it('sorts newest-first by createdAt', () => {
    const result = buildSessionMediaManifest([
      { generatedImages: [img({ generatedMediaId: 'old', createdAt: 100 })] },
      { generatedImages: [img({ generatedMediaId: 'new', createdAt: 999 })] },
    ]);
    expect(result.map((m) => m.generatedMediaId)).toEqual(['new', 'old']);
  });

  it('dedups by id, keeping the freshest (pending→ready on the same id)', () => {
    const result = buildSessionMediaManifest([
      { generatedImages: [img({ generatedMediaId: '7', status: 'pending', createdAt: 100 })] },
      {
        generatedImages: [
          img({ generatedMediaId: '7', status: 'ready', createdAt: 100, updatedAt: 200 }),
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('ready');
  });

  it(`caps at ${SESSION_MEDIA_LIMIT}, dropping the oldest`, () => {
    const messages = Array.from({ length: SESSION_MEDIA_LIMIT + 1 }, (_, i) => ({
      generatedImages: [img({ generatedMediaId: `id-${i}`, createdAt: i + 1 })],
    }));
    const result = buildSessionMediaManifest(messages);
    expect(result).toHaveLength(SESSION_MEDIA_LIMIT);
    // createdAt=1 (id-0) is the oldest → dropped; the newest is first.
    expect(result.some((m) => m.generatedMediaId === 'id-0')).toBe(false);
    expect(result[0]?.generatedMediaId).toBe(`id-${SESSION_MEDIA_LIMIT}`);
  });
});

describe('sanitizeSessionMedia', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeSessionMedia(undefined)).toEqual([]);
    expect(sanitizeSessionMedia(null)).toEqual([]);
    expect(sanitizeSessionMedia('nope')).toEqual([]);
    expect(sanitizeSessionMedia({})).toEqual([]);
  });

  it('keeps well-formed entries and coerces fields', () => {
    const result = sanitizeSessionMedia([
      {
        generatedMediaId: ' 42 ',
        kind: 'image',
        styleTag: 'research_gap_card',
        status: 'ready',
        createdAt: 123,
      },
    ]);
    expect(result).toEqual([
      {
        generatedMediaId: '42',
        kind: 'image',
        styleTag: 'research_gap_card',
        status: 'ready',
        createdAt: 123,
      },
    ]);
  });

  it('drops entries with non-numeric ids and bad kinds', () => {
    const result = sanitizeSessionMedia([
      { generatedMediaId: 'abc', kind: 'image' },
      { generatedMediaId: '5', kind: 'gif' },
      { generatedMediaId: '6', kind: 'video' },
    ]);
    expect(result).toEqual([
      {
        generatedMediaId: '6',
        kind: 'video',
        styleTag: undefined,
        status: undefined,
        createdAt: undefined,
      },
    ]);
  });

  it('clamps unknown status and non-finite createdAt to undefined', () => {
    const [item] = sanitizeSessionMedia([
      { generatedMediaId: '9', kind: 'image', status: 'bogus', createdAt: Number.NaN },
    ]);
    expect(item?.status).toBeUndefined();
    expect(item?.createdAt).toBeUndefined();
  });

  it(`caps at ${SESSION_MEDIA_LIMIT}`, () => {
    const raw = Array.from({ length: SESSION_MEDIA_LIMIT + 5 }, (_, i) => ({
      generatedMediaId: String(i + 1),
      kind: 'image' as const,
    }));
    expect(sanitizeSessionMedia(raw)).toHaveLength(SESSION_MEDIA_LIMIT);
  });
});

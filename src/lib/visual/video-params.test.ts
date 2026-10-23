import { describe, expect, it } from 'vitest';
import { normalizeVideoParams, VIDEO_DEFAULTS } from './video-params';

describe('normalizeVideoParams', () => {
  it('passes through a valid set unchanged', () => {
    expect(
      normalizeVideoParams({
        aspectRatio: '16:9',
        durationSeconds: 12,
        resolution: '720p',
        mode: 'fast',
        genre: 'action',
      }),
    ).toEqual({
      aspectRatio: '16:9',
      durationSeconds: 12,
      resolution: '720p',
      mode: 'fast',
      genre: 'action',
    });
  });

  it('falls back to defaults for unknown values', () => {
    // These used to reach the CLI verbatim from the agent tool. `generate
    // create` whitelists unknown flag VALUES into its params payload, so the
    // rejection came from the server as an unexplained failure.
    expect(
      normalizeVideoParams({
        aspectRatio: '4:5',
        resolution: '8k',
        mode: 'turbo',
        genre: 'documentary',
      }),
    ).toMatchObject({
      aspectRatio: VIDEO_DEFAULTS.aspectRatio,
      resolution: VIDEO_DEFAULTS.resolution,
      genre: VIDEO_DEFAULTS.genre,
    });
  });

  it('never lets a flag-shaped string through', () => {
    expect(normalizeVideoParams({ genre: '--wait' }).genre).toBe(VIDEO_DEFAULTS.genre);
  });

  it('clamps duration to the 5-15s window', () => {
    // The API accepts 4-15 (3 and 16 are both rejected by name); 5 is our own
    // deliberate floor, matching what the popover offers.
    expect(normalizeVideoParams({ durationSeconds: 15 }).durationSeconds).toBe(15);
    expect(normalizeVideoParams({ durationSeconds: 999 }).durationSeconds).toBe(15);
    expect(normalizeVideoParams({ durationSeconds: 1 }).durationSeconds).toBe(5);
    expect(normalizeVideoParams({ durationSeconds: 'nonsense' }).durationSeconds).toBe(
      VIDEO_DEFAULTS.durationSeconds,
    );
  });

  it('promotes mode to std for 1080p/4k rather than shipping an impossible pair', () => {
    // `fast` supports only 480p/720p. The API rejects the combination only
    // after the job is staged.
    expect(normalizeVideoParams({ resolution: '1080p', mode: 'fast' }).mode).toBe('std');
    expect(normalizeVideoParams({ resolution: '4k', mode: 'fast' }).mode).toBe('std');
    expect(normalizeVideoParams({ resolution: '720p', mode: 'fast' }).mode).toBe('fast');
  });

  it('uses vertical 9:16 defaults when nothing is supplied', () => {
    expect(normalizeVideoParams({})).toEqual({ ...VIDEO_DEFAULTS });
  });
});

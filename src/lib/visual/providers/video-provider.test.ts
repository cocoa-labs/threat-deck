/**
 * Tests for getVideoProvider() — the local-CLI vs remote-worker switch keyed on
 * HIGGSFIELD_REMOTE_URL.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiggsfieldCliVideoProvider } from '@/lib/visual/providers/higgsfield-cli-video';
import { HiggsfieldRemoteVideoProvider } from '@/lib/visual/providers/higgsfield-remote-video';
import { getVideoProvider, isRemoteVideoConfigured } from '@/lib/visual/providers/video-provider';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getVideoProvider', () => {
  it('uses the local CLI provider when HIGGSFIELD_REMOTE_URL is unset', () => {
    vi.stubEnv('HIGGSFIELD_REMOTE_URL', '');
    expect(isRemoteVideoConfigured()).toBe(false);
    expect(getVideoProvider()).toBeInstanceOf(HiggsfieldCliVideoProvider);
  });

  it('uses the remote provider when HIGGSFIELD_REMOTE_URL is set', () => {
    vi.stubEnv('HIGGSFIELD_REMOTE_URL', 'http://worker.test');
    vi.stubEnv('INTERNAL_RENDER_SECRET', 'sekret');
    expect(isRemoteVideoConfigured()).toBe(true);
    expect(getVideoProvider()).toBeInstanceOf(HiggsfieldRemoteVideoProvider);
  });

  it('treats a whitespace-only HIGGSFIELD_REMOTE_URL as unset', () => {
    vi.stubEnv('HIGGSFIELD_REMOTE_URL', '   ');
    expect(isRemoteVideoConfigured()).toBe(false);
    expect(getVideoProvider()).toBeInstanceOf(HiggsfieldCliVideoProvider);
  });

  it('ignores HIGGSFIELD_REMOTE_URL on the Fly worker itself', () => {
    // The worker IS the CLI host. If the var leaks into its shared env, it
    // would forward renders to itself over the network for no reason.
    vi.stubEnv('HIGGSFIELD_REMOTE_URL', 'http://worker.test');
    vi.stubEnv('FLY_MACHINE_ID', '148e213a7e1289');
    expect(isRemoteVideoConfigured()).toBe(false);
    expect(getVideoProvider()).toBeInstanceOf(HiggsfieldCliVideoProvider);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/security/safe-fetch');
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), options: null as unknown }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('undici', () => ({
  fetch: mocks.fetch,
  Agent: class {
    constructor(options: unknown) {
      mocks.options = options;
    }
  },
}));

import { isPublicAddress, safeFetch, validatePublicUrl } from './safe-fetch';

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
describe('outbound address boundaries', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.2.3',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:169.254.169.254',
  ])('rejects nonpublic %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each([
    'file:///etc/passwd',
    'http://127.1',
    'http://2130706433',
    'http://169.254.169.254/latest/meta-data',
    'https://localhost',
    'https://example.org:5432',
    'https://user:password@example.org',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(validatePublicUrl(url)).rejects.toThrow();
  });
  it('blocks a redirect into the private network', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1' } }),
    );
    await expect(safeFetch('https://public.example')).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds response bytes even without Content-Length', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('123456'));
    await expect(safeFetch('https://public.example', {}, 5)).rejects.toThrow('upstream_too_large');
  });
  it('revalidates DNS at connection time', async () => {
    await validatePublicUrl('https://public.example');
    mocks.lookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const options = mocks.options as {
      connect: {
        lookup: (host: string, options: object, callback: (error: Error | null) => void) => void;
      };
    };
    const error = await new Promise<Error | null>((resolve) =>
      options.connect.lookup('public.example', {}, resolve),
    );
    expect(error?.message).toBe('unsafe_address');
  });
});

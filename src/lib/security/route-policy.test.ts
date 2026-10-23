import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/security/route-policy');
const fixtures = vi.hoisted(() => ({
  email: 'operator@example.org' as string | null,
  allowed: true,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { email: fixtures.email } }) }));
vi.mock('@/lib/security/rate-limit', () => ({
  getClientIp: () => 'test',
  checkRateLimit: async () => ({ allowed: fixtures.allowed }),
}));

import { withRoutePolicy } from './route-policy';

beforeEach(() => {
  fixtures.email = 'operator@example.org';
  fixtures.allowed = true;
  vi.stubEnv('ALLOWED_EMAILS', 'operator@example.org');
  vi.stubEnv('NEXTAUTH_URL', 'https://deck.example.org');
  vi.stubEnv('ENABLE_AI', 'true');
  vi.stubEnv('ENABLE_AUTOMATION', 'true');
  vi.stubEnv('CRON_SECRET', 'test-cron-secret-with-at-least-32-characters');
});
const request = (method = 'GET', origin?: string, body?: string) =>
  new Request('https://deck.example.org/api/test', {
    method,
    headers: origin ? { origin } : undefined,
    body,
  });
describe('API security boundary', () => {
  it.each(['/api/data/cves', '/api/aegis/cves/view', '/api/agent/memory', '/api/outbound/drafts'])(
    'rejects anonymous access to %s',
    async (path) => {
      fixtures.email = null;
      const handler = vi.fn((_req: Request) => Response.json({ private: true }));
      expect((await withRoutePolicy(path, handler)(request())).status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    },
  );
  it('rejects a revoked operator with a still-valid session', async () => {
    vi.stubEnv('ALLOWED_EMAILS', 'another@example.org');
    expect(
      (await withRoutePolicy('/api/data/cves', (_req: Request) => new Response())(request()))
        .status,
    ).toBe(401);
  });
  it.each([undefined, 'https://attacker.example'])('rejects mutation origin %s', async (origin) => {
    expect(
      (
        await withRoutePolicy(
          '/api/agent/stream',
          (_req: Request) => new Response(),
        )(request('POST', origin, '{}'))
      ).status,
    ).toBe(403);
  });
  it('does not invoke a disabled paid capability', async () => {
    vi.stubEnv('ENABLE_AI', 'false');
    const handler = vi.fn((_req: Request) => new Response());
    expect(
      (
        await withRoutePolicy(
          '/api/agent/stream',
          handler,
        )(request('POST', 'https://deck.example.org', '{}'))
      ).status,
    ).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });
  it('denies writes when admission control is unavailable', async () => {
    fixtures.allowed = false;
    expect(
      (
        await withRoutePolicy(
          '/api/preferences',
          (_req: Request) => new Response(),
        )(request('POST', 'https://deck.example.org', '{}'))
      ).status,
    ).toBe(429);
  });
  it('rejects a chunked oversized body before parsing', async () => {
    const handler = vi.fn((_req: Request) => new Response());
    expect(
      (
        await withRoutePolicy(
          '/api/preferences',
          handler,
        )(request('POST', 'https://deck.example.org', 'x'.repeat(1024 * 1024 + 1)))
      ).status,
    ).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });
  it('preserves a bounded JSON request and prevents caching', async () => {
    const response = await withRoutePolicy('/api/preferences', async (req: Request) =>
      Response.json(await req.json()),
    )(request('POST', 'https://deck.example.org', '{"ok":true}'));
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('requires an independent cron secret even for an operator', async () => {
    const handler = vi.fn((_req: Request) => new Response());
    expect((await withRoutePolicy('/api/cron/aegis-ingest', handler)(request())).status).toBe(401);
    const req = new Request('https://deck.example.org/api/cron/aegis-ingest', {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect((await withRoutePolicy('/api/cron/aegis-ingest', handler)(req)).status).toBe(200);
  });
});

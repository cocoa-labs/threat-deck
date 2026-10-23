import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentSecurityPolicy } from './csp';

const nonce = 'c3ludGhldGljLW5vbmNlLXZhbHVl';
afterEach(() => vi.unstubAllEnvs());
describe('per-request CSP', () => {
  it('blocks arbitrary inline scripts, eval, event handlers and objects in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const policy = contentSecurityPolicy(nonce);
    const script = policy.split('; ').find((d) => d.startsWith('script-src '));
    expect(script).toContain(`'nonce-${nonce}'`);
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
  it('preserves Mapbox workers, sprites, WebAssembly and required connections', () => {
    const policy = contentSecurityPolicy(nonce);
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("child-src 'self' blob:");
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain('https://api.mapbox.com');
    expect(policy).toContain('https://events.mapbox.com');
  });
  it('does not authorize arbitrary network origins or malformed configured tokens', () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://relay.example.org/ws');
    vi.stubEnv(
      'CSP_CONNECT_ORIGINS',
      "https://video.example.net/path,https://good.example;script-src 'unsafe-inline',https://user:pass@example.org",
    );
    const connect = contentSecurityPolicy(nonce)
      .split('; ')
      .find((d) => d.startsWith('connect-src '))!;
    expect(connect).toContain('wss://relay.example.org');
    expect(connect).toContain('https://video.example.net');
    expect(connect.split(' ')).not.toContain('https:');
    expect(connect.split(' ')).not.toContain('wss:');
    expect(connect).not.toContain('unsafe-inline');
    expect(connect).not.toContain('user:pass');
    expect(() => contentSecurityPolicy("bad' nonce")).toThrow('invalid_csp_nonce');
  });
  it('permits the explicitly public feed to be framed without relaxing scripts', () => {
    expect(contentSecurityPolicy(nonce, true)).toContain('frame-ancestors *');
    expect(contentSecurityPolicy(nonce, true)).toContain(`'nonce-${nonce}'`);
  });
});

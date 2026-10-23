import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tickets: new Map<string, string>(), fail: false }));
vi.mock('@/lib/redis/client', () => ({
  redis: {
    set: async (key: string, value: string) => {
      if (state.fail) throw new Error('offline');
      state.tickets.set(key, value);
      return 'OK';
    },
    getdel: async (key: string) => {
      if (state.fail) throw new Error('offline');
      const value = state.tickets.get(key);
      state.tickets.delete(key);
      return value;
    },
  },
}));

import { consumeWSTicket, issueWSTicket } from './tickets';

beforeEach(() => {
  state.tickets.clear();
  state.fail = false;
  vi.stubEnv('NEXTAUTH_URL', 'https://deck.example.org');
  vi.stubEnv('WS_AUTH_SECRET', 'test-ws-secret-with-at-least-32-characters');
  vi.stubEnv('ALLOWED_EMAILS', 'operator@example.org');
});
describe('WebSocket tickets', () => {
  it('can only be consumed once', async () => {
    const ticket = await issueWSTicket('operator@example.org');
    expect(await consumeWSTicket(ticket, 'https://deck.example.org')).toBe('operator@example.org');
    expect(await consumeWSTicket(ticket, 'https://deck.example.org')).toBeNull();
  });
  it('rejects forged credentials, cross-origin use and revoked operators', async () => {
    const ticket = await issueWSTicket('operator@example.org');
    expect(await consumeWSTicket(`${ticket}x`, 'https://deck.example.org')).toBeNull();
    expect(await consumeWSTicket(ticket, 'https://attacker.example')).toBeNull();
    vi.stubEnv('ALLOWED_EMAILS', 'another@example.org');
    expect(await consumeWSTicket(ticket, 'https://deck.example.org')).toBeNull();
  });
  it('expires after one minute', async () => {
    vi.useFakeTimers();
    try {
      const ticket = await issueWSTicket('operator@example.org');
      vi.advanceTimersByTime(60_001);
      expect(await consumeWSTicket(ticket, 'https://deck.example.org')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('fails closed when Redis is unavailable', async () => {
    state.fail = true;
    await expect(issueWSTicket('operator@example.org')).rejects.toThrow();
    expect(await consumeWSTicket('invalid', 'https://deck.example.org')).toBeNull();
  });
});

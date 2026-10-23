import { describe, expect, it, vi } from 'vitest';
import { handleAegisPushMessage } from './redis-bridge';

describe('handleAegisPushMessage', () => {
  it('broadcasts a valid refresh nudge on a known cyber channel', () => {
    const broadcast = vi.fn();
    handleAegisPushMessage(
      JSON.stringify({ channel: 'cves', type: 'refresh', count: 3 }),
      broadcast,
    );
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('cves', 'refresh', { count: 3 });
  });

  it('passes the count through for every cyber channel', () => {
    const channels = ['cves', 'kev', 'iocs', 'breaches', 'advisories'] as const;
    for (const channel of channels) {
      const broadcast = vi.fn();
      handleAegisPushMessage(JSON.stringify({ channel, type: 'refresh', count: 7 }), broadcast);
      expect(broadcast).toHaveBeenCalledWith(channel, 'refresh', { count: 7 });
    }
  });

  it('ignores an unknown channel', () => {
    const broadcast = vi.fn();
    handleAegisPushMessage(
      JSON.stringify({ channel: 'markets', type: 'refresh', count: 3 }),
      broadcast,
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('ignores a wrong message type', () => {
    const broadcast = vi.fn();
    handleAegisPushMessage(
      JSON.stringify({ channel: 'cves', type: 'delete', count: 3 }),
      broadcast,
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not throw and does not broadcast on malformed JSON', () => {
    const broadcast = vi.fn();
    expect(() => handleAegisPushMessage('{not json', broadcast)).not.toThrow();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('ignores a non-object JSON payload', () => {
    const broadcast = vi.fn();
    handleAegisPushMessage('42', broadcast);
    handleAegisPushMessage('null', broadcast);
    handleAegisPushMessage('"refresh"', broadcast);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('defaults count to 0 when missing or non-numeric', () => {
    const broadcast = vi.fn();
    handleAegisPushMessage(JSON.stringify({ channel: 'kev', type: 'refresh' }), broadcast);
    expect(broadcast).toHaveBeenCalledWith('kev', 'refresh', { count: 0 });
  });
});

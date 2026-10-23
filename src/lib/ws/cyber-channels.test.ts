import { describe, expect, it } from 'vitest';
import { CYBER_CHANNELS, cyberChannelToQueryKeys } from './cyber-channels';

describe('cyberChannelToQueryKeys', () => {
  it("maps 'cves' to both the feed and AEGIS CVE query keys", () => {
    expect(cyberChannelToQueryKeys('cves')).toEqual([['cves'], ['aegis-cves']]);
  });

  it("maps 'kev' to the KEV query key", () => {
    expect(cyberChannelToQueryKeys('kev')).toEqual([['kev']]);
  });

  it("maps 'iocs' to the IOC query key", () => {
    expect(cyberChannelToQueryKeys('iocs')).toEqual([['iocs']]);
  });

  it("maps 'breaches' to the feed breach key and the AEGIS incident key", () => {
    expect(cyberChannelToQueryKeys('breaches')).toEqual([['breaches'], ['aegis-incidents']]);
  });

  it("maps 'advisories' to the advisory and patch query keys", () => {
    expect(cyberChannelToQueryKeys('advisories')).toEqual([['advisories'], ['patches']]);
  });

  it('returns [] for a non-cyber WS channel and unknown strings', () => {
    // The mapping accepts `WSChannel | string` so callers can pass any channel
    // off the wire; non-cyber channels must map to no keys.
    expect(cyberChannelToQueryKeys('markets')).toEqual([]);
    expect(cyberChannelToQueryKeys('agent')).toEqual([]);
    expect(cyberChannelToQueryKeys('nope')).toEqual([]);
  });

  it('returns a non-empty key array for every declared cyber channel', () => {
    for (const channel of CYBER_CHANNELS) {
      const keys = cyberChannelToQueryKeys(channel);
      expect(keys.length).toBeGreaterThan(0);
      // Each entry is a query-key prefix (array of strings).
      for (const key of keys) {
        expect(Array.isArray(key)).toBe(true);
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });
});

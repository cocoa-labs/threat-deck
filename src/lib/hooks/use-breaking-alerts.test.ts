/**
 * Tests for the hero breaking-alert gate.
 *
 * The red flashing banner is the loudest surface in the product. Two things
 * must hold: it never fires below the operator's severity threshold, and it
 * never fires for an alert with no coordinates (it lives on the map). The
 * regression these guard against is the old MapDataProvider watcher, which
 * fired on any geotagged defense-industry news story.
 */

import { describe, expect, it } from 'vitest';
import type { AlertHistoryItem, Severity } from '@/lib/types';
import { BREAKING_MAX_AGE_MS, selectBreakingAlert } from './use-breaking-alerts';

let seq = 0;

function alert(overrides: Partial<AlertHistoryItem> = {}): AlertHistoryItem {
  seq += 1;
  return {
    id: `alert-${seq}`,
    severity: 'critical' as Severity,
    title: 'KEV: something bad',
    triggerData: null,
    acknowledged: false,
    createdAt: new Date().toISOString(),
    alertType: 'new_kev',
    location: { lat: 38.9, lon: -77.04, name: 'Washington' },
    ...overrides,
  };
}

describe('selectBreakingAlert', () => {
  it('returns the newest qualifying alert', () => {
    const first = alert({ title: 'first' });
    const second = alert({ title: 'second' });
    // The store keeps newest-first.
    expect(selectBreakingAlert([first, second], 'critical')?.title).toBe('first');
  });

  it('never fires when the threshold is off', () => {
    expect(selectBreakingAlert([alert()], 'off')).toBeNull();
  });

  it('at "critical", ignores high-severity alerts', () => {
    expect(selectBreakingAlert([alert({ severity: 'high' })], 'critical')).toBeNull();
    expect(selectBreakingAlert([alert({ severity: 'critical' })], 'critical')).not.toBeNull();
  });

  it('at "critical_high", accepts both but still rejects medium', () => {
    expect(selectBreakingAlert([alert({ severity: 'high' })], 'critical_high')).not.toBeNull();
    expect(selectBreakingAlert([alert({ severity: 'critical' })], 'critical_high')).not.toBeNull();
    expect(selectBreakingAlert([alert({ severity: 'medium' })], 'critical_high')).toBeNull();
  });

  it('is geo-gated — an alert without coordinates never raises the banner', () => {
    expect(selectBreakingAlert([alert({ location: null })], 'critical')).toBeNull();
    expect(selectBreakingAlert([alert({ location: undefined })], 'critical')).toBeNull();
  });

  it('skips a non-resolving critical alert in favour of a resolving one behind it', () => {
    const noGeo = alert({ title: 'no geo', location: null });
    const withGeo = alert({ title: 'has geo' });
    expect(selectBreakingAlert([noGeo, withGeo], 'critical')?.title).toBe('has geo');
  });

  it('ignores acknowledged alerts', () => {
    expect(selectBreakingAlert([alert({ acknowledged: true })], 'critical')).toBeNull();
  });

  it('returns null on an empty board', () => {
    expect(selectBreakingAlert([], 'critical')).toBeNull();
  });

  // A seeded 2024 KEV row owned the banner for 784 days: it was the only
  // critical unacknowledged row in the table, and nothing gated on age.
  describe('recency gate', () => {
    const NOW = 1_800_000_000_000;

    it('ignores an alert older than the max age even at critical', () => {
      const stale = alert({
        title: 'CISA KEV: Check Point Quantum VPN (CVE-2024-24919)',
        createdAt: new Date(NOW - BREAKING_MAX_AGE_MS - 60_000).toISOString(),
      });
      expect(selectBreakingAlert([stale], 'critical', NOW)).toBeNull();
    });

    it('accepts an alert just inside the window', () => {
      const fresh = alert({
        createdAt: new Date(NOW - BREAKING_MAX_AGE_MS + 60_000).toISOString(),
      });
      expect(selectBreakingAlert([fresh], 'critical', NOW)).not.toBeNull();
    });

    it('skips a stale critical in favour of a recent one behind it', () => {
      const stale = alert({
        title: 'stale',
        createdAt: new Date(NOW - 90 * 24 * 3_600_000).toISOString(),
      });
      const fresh = alert({ title: 'fresh', createdAt: new Date(NOW - 60_000).toISOString() });
      expect(selectBreakingAlert([stale, fresh], 'critical', NOW)?.title).toBe('fresh');
    });

    it('treats an unparseable timestamp as not recent', () => {
      expect(selectBreakingAlert([alert({ createdAt: 'not-a-date' })], 'critical', NOW)).toBeNull();
    });
  });
});

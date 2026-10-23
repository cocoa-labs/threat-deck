/**
 * Tests for the trigger → `aegis_pipeline_alerts` mapping.
 *
 * This mapping is what makes an alert citable: the wrong `entity_kind`/
 * `entity_id` pair yields a row whose source link points nowhere, which is the
 * exact failure the old breaking-alert overlay had (an alert with nothing to
 * click). `alertDescriptorFor` is pure, so these run without a database.
 */

import { describe, expect, it } from 'vitest';
import { deriveSourceUrl } from '@/lib/aegis/source-url';
import { alertDescriptorFor, extractBluf } from './activation';

describe('alertDescriptorFor', () => {
  it('maps a KEV addition to a CVE-kinded alert keyed on the CVE id', () => {
    const d = alertDescriptorFor('cve.kev_added', {
      cve_id: 'CVE-2024-3400',
      vulnerability_name: 'PAN-OS command injection',
      vendor_project: 'Palo Alto',
    });

    expect(d).toEqual({
      alertType: 'new_kev',
      entityKind: 'cve',
      entityId: 'CVE-2024-3400',
      headline: 'KEV: PAN-OS command injection (Palo Alto)',
    });
    // The whole point of the entity pair — it must resolve to a real viewer.
    expect(deriveSourceUrl(d!.entityKind, d!.entityId, { relative: true })).toBe(
      '/api/aegis/cves/view?id=CVE-2024-3400',
    );
  });

  it('falls back to the CVE id when the vulnerability has no name', () => {
    const d = alertDescriptorFor('cve.kev_added', { cve_id: 'CVE-2024-1' });
    expect(d?.headline).toBe('KEV: CVE-2024-1');
  });

  it('maps a breach with an org id to the compromised-orgs viewer', () => {
    const d = alertDescriptorFor('breach.disclosed', {
      org_id: '42',
      breach_id: '9',
      records_compromised: 12_000_000,
      source_url: 'https://example.com/breach',
    });

    expect(d?.entityKind).toBe('breach');
    expect(d?.entityId).toBe('42');
    expect(d?.alertType).toBe('new_breach');
    expect(deriveSourceUrl(d!.entityKind, d!.entityId, { relative: true })).toBe(
      '/api/aegis/compromised-orgs/view?id=42',
    );
  });

  it('falls back to the disclosure URL when a breach has no org id', () => {
    const d = alertDescriptorFor('breach.disclosed', {
      records_compromised: 500,
      source_url: 'https://example.com/breach',
    });

    expect(d?.entityKind).toBe('advisory');
    expect(d?.entityId).toBe('https://example.com/breach');
    // A URL entity id passes through as its own citation.
    expect(deriveSourceUrl(d!.entityKind, d!.entityId, { relative: true })).toBe(
      'https://example.com/breach',
    );
  });

  it('formats breach record counts in the fallback headline', () => {
    expect(
      alertDescriptorFor('breach.disclosed', { org_id: '1', records_compromised: 12_000_000 })
        ?.headline,
    ).toBe('Breach disclosed: 12M records');
    expect(
      alertDescriptorFor('breach.disclosed', { org_id: '1', records_compromised: 4200 })?.headline,
    ).toBe('Breach disclosed: 4,200 records');
  });

  it('prefers the advisory URL over the advisory id for patches', () => {
    const d = alertDescriptorFor('patch.released', {
      advisory_id: 'MSRC-123',
      advisory_url: 'https://msrc.microsoft.com/123',
      vendor: 'microsoft',
    });
    expect(d?.entityId).toBe('https://msrc.microsoft.com/123');
    expect(d?.alertType).toBe('new_patch');
  });

  it('uses the article URL as the entity id for breaking news', () => {
    const d = alertDescriptorFor('news.breaking', {
      id: 'news-1',
      url: 'https://krebsonsecurity.com/post',
      title: 'Something happened',
    });
    expect(d?.entityKind).toBe('news');
    expect(d?.entityId).toBe('https://krebsonsecurity.com/post');
    expect(d?.headline).toBe('Something happened');
  });

  it('prefers an explicit headline over the mechanical fallback', () => {
    const d = alertDescriptorFor('news.breaking', {
      id: 'news-1',
      headline: 'Operator-supplied headline',
      title: 'Raw title',
    });
    expect(d?.headline).toBe('Operator-supplied headline');
  });

  it('returns null when there is no usable entity id — an uncitable alert', () => {
    expect(alertDescriptorFor('cve.kev_added', {})).toBeNull();
    expect(alertDescriptorFor('patch.released', { vendor: 'microsoft' })).toBeNull();
    expect(alertDescriptorFor('news.breaking', {})).toBeNull();
  });

  it('maps a CERT advisory to an advisory row, not a patch', () => {
    // The regression: CERT items used to ride patch.released, and the task
    // template told the agent a security update had shipped when none had.
    const d = alertDescriptorFor('advisory.published', {
      advisory_id: 'ncsc-2026-01',
      advisory_url: 'https://www.ncsc.gov.uk/news/joint-advisory',
      issuer: 'ncsc_uk',
      vendor: 'ncsc_uk',
      severity: 'critical',
    });

    expect(d?.alertType).toBe('advisory');
    expect(d?.entityKind).toBe('advisory');
    expect(d?.entityId).toBe('https://www.ncsc.gov.uk/news/joint-advisory');
    expect(deriveSourceUrl(d!.entityKind, d!.entityId, { relative: true })).toBe(
      'https://www.ncsc.gov.uk/news/joint-advisory',
    );
  });

  it('keys a watchlist match on the matched ITEM, not the monitor', () => {
    // Keying on monitor_id would collapse every hit a watchlist ever gets into
    // one row per day under the 24h dedup guard, and cite a dead focus link.
    const d = alertDescriptorFor('monitor.keyword_match', {
      monitor_id: 'a5f1c0de-0000-0000-0000-000000000000',
      monitor_name: 'Fortinet exposure',
      source: 'news',
      item_id: 'rss-1',
      url: 'https://krebsonsecurity.com/fortinet',
      headline: 'Fortinet exposure: Fortinet patches FortiOS',
    });

    expect(d?.alertType).toBe('monitor_match');
    expect(d?.entityKind).toBe('news');
    expect(d?.entityId).toBe('https://krebsonsecurity.com/fortinet');
    expect(d?.headline).toBe('Fortinet exposure: Fortinet patches FortiOS');
  });

  it('falls back to the item id when a watchlist match has no URL', () => {
    const d = alertDescriptorFor('monitor.keyword_match', {
      monitor_id: 'm1',
      monitor_name: 'KEV watch',
      source: 'kev',
      item_id: 'CVE-2026-1',
    });
    expect(d?.entityId).toBe('CVE-2026-1');
    expect(d?.entityKind).toBe('kev');
  });

  it('returns null for schedule triggers — recurring briefs are not alerts', () => {
    expect(alertDescriptorFor('schedule.morning_brief', { task: 'brief' })).toBeNull();
    expect(alertDescriptorFor('schedule.overnight_scan', {})).toBeNull();
  });

  it('covers every real event trigger', () => {
    // Guards against a new trigger being registered without an alert mapping,
    // which would silently produce activations that never reach the board.
    const cases: [string, Record<string, unknown>][] = [
      ['cve.kev_added', { cve_id: 'CVE-1' }],
      ['breach.disclosed', { org_id: '1' }],
      ['patch.released', { advisory_id: 'A-1' }],
      ['news.breaking', { id: 'n-1' }],
      ['monitor.keyword_match', { monitor_id: 'm-1' }],
      ['advisory.published', { advisory_id: 'a-1' }],
    ];
    for (const [eventType, data] of cases) {
      expect(alertDescriptorFor(eventType, data), eventType).not.toBeNull();
    }
  });
});

describe('extractBluf', () => {
  it('pulls the BLUF line and strips bold markers', () => {
    expect(extractBluf('**BLUF:** CISA added CVE-2024-3400 to KEV.\n\nMore detail here.')).toBe(
      'CISA added CVE-2024-3400 to KEV.',
    );
  });

  it('falls back to the first substantive line', () => {
    expect(extractBluf('\n\nShort\nA genuinely substantive first line.\n')).toBe(
      'A genuinely substantive first line.',
    );
  });

  it('returns null when there is nothing usable', () => {
    expect(extractBluf('   \n \n')).toBeNull();
  });

  it('truncates to the requested length', () => {
    expect(extractBluf(`BLUF: ${'x'.repeat(500)}`)).toHaveLength(180);
  });
});

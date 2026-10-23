/**
 * Tests for the `aegis_pipeline_alerts` row → client `AlertHistoryItem` mapper.
 *
 * Both the WS push and the REST read go through this function, so a bug here
 * corrupts the ALERTS board from either direction. Pure — no database.
 */

import { describe, expect, it } from 'vitest';
import type { PipelineAlertRow } from '@/lib/db/queries/pipeline-alerts';
import { alertTypeLabel, toAlertHistoryItem } from './alert-mapper';

function row(overrides: Partial<PipelineAlertRow> = {}): PipelineAlertRow {
  return {
    id: 7,
    alert_type: 'new_kev',
    entity_kind: 'cve',
    entity_id: 'CVE-2024-3400',
    severity: 'critical',
    headline: 'KEV: PAN-OS command injection',
    summary: 'CISA added it to the catalogue.',
    published_at: '2026-07-22T12:00:00.000Z',
    status: 'new',
    ai_relevance: '0.820',
    created_at: '2026-07-22T12:00:01.000Z',
    ...overrides,
  };
}

describe('toAlertHistoryItem', () => {
  it('produces a fully JSON-serializable item with a relative source link', () => {
    const item = toAlertHistoryItem(row());

    expect(item).toMatchObject({
      id: '7', // string, not the numeric PK (rule #1)
      severity: 'critical',
      title: 'KEV: PAN-OS command injection',
      alertType: 'new_kev',
      entityKind: 'cve',
      entityId: 'CVE-2024-3400',
      status: 'new',
      acknowledged: false,
      aiRelevance: 0.82,
      location: null,
    });
    // Relative — an absolute URL would break on localhost/preview deploys.
    expect(item.sourceUrl).toBe('/api/aegis/cves/view?id=CVE-2024-3400');
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
  });

  it('derives `acknowledged` from status so existing consumers keep working', () => {
    expect(toAlertHistoryItem(row({ status: 'new' })).acknowledged).toBe(false);
    expect(toAlertHistoryItem(row({ status: 'triaging' })).acknowledged).toBe(true);
    expect(toAlertHistoryItem(row({ status: 'resolved' })).acknowledged).toBe(true);
  });

  it('attaches a resolved location when one is supplied', () => {
    const item = toAlertHistoryItem(row(), { lat: 1, lon: 2, name: 'Kyiv' });
    expect(item.location).toEqual({ lat: 1, lon: 2, name: 'Kyiv' });
  });

  it('passes a URL entity id through as its own citation', () => {
    const item = toAlertHistoryItem(
      row({ entity_kind: 'news', entity_id: 'https://krebsonsecurity.com/post' }),
    );
    expect(item.sourceUrl).toBe('https://krebsonsecurity.com/post');
  });

  it('coerces an unknown severity to info rather than leaking a raw string', () => {
    expect(toAlertHistoryItem(row({ severity: 'catastrophic' })).severity).toBe('info');
  });

  it('handles null ai_relevance and null text fields', () => {
    const item = toAlertHistoryItem(row({ ai_relevance: null, headline: null, summary: null }));
    expect(item.aiRelevance).toBeNull();
    expect(item.title).toBeUndefined();
    expect(item.summary).toBeUndefined();
  });
});

describe('alertTypeLabel', () => {
  it('gives each alert type a human kicker', () => {
    expect(alertTypeLabel('new_kev')).toBe('KEV ADDED');
    expect(alertTypeLabel('new_breach')).toBe('BREACH');
    expect(alertTypeLabel('new_patch')).toBe('PATCH');
  });

  it('degrades gracefully for unknown or missing types', () => {
    expect(alertTypeLabel('some_new_kind')).toBe('SOME NEW KIND');
    expect(alertTypeLabel(null)).toBe('ALERT');
    expect(alertTypeLabel(undefined)).toBe('ALERT');
  });
});

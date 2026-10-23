/**
 * Tests for the watchlist match → alert-spine bridge.
 *
 * The regression: `monitor_match_log` was write-only. A watchlist could match
 * and the operator would never learn about it — no alert row, no toast, no
 * panel, no agent event. `buildMatchAlert` is the shape that carries a hit onto
 * the ALERTS board, so it has to stay citable (rule #21) and it must NOT dedup
 * through the pipeline guard (two monitors hitting one article are two hits).
 */

import { describe, expect, it } from 'vitest';
import { deriveSourceUrl } from '@/lib/aegis/source-url';
import { buildMatchAlert } from './scan';

const MONITOR = { name: 'Fortinet exposure', severity: 'high' };

describe('buildMatchAlert', () => {
  it('keys on the article URL so the board row deep-links to the source', () => {
    const alert = buildMatchAlert(
      MONITOR,
      'news',
      {
        id: 'rss-12345',
        text: 'body',
        title: 'Fortinet patches critical FortiOS flaw',
        url: 'https://krebsonsecurity.com/fortinet',
      },
      'fortinet',
    );

    expect(alert.entityId).toBe('https://krebsonsecurity.com/fortinet');
    // An absolute URL passes through deriveSourceUrl untouched — the whole
    // point of keying on it rather than the monitor id.
    expect(deriveSourceUrl(alert.entityKind, alert.entityId, { relative: true })).toBe(
      'https://krebsonsecurity.com/fortinet',
    );
  });

  it('falls back to the item id when the URL is relative or missing', () => {
    expect(
      buildMatchAlert(
        MONITOR,
        'cve',
        {
          id: 'CVE-2026-1234',
          text: 't',
          title: 'CVE-2026-1234',
          url: '/api/aegis/cves/view?id=CVE-2026-1234',
        },
        'cve',
      ).entityId,
    ).toBe('CVE-2026-1234');

    expect(
      buildMatchAlert(MONITOR, 'cve', { id: 'CVE-2026-9999', text: 't', title: 'x' }, 'cve')
        .entityId,
    ).toBe('CVE-2026-9999');
  });

  it('names the monitor in the headline so the board says WHY it fired', () => {
    const alert = buildMatchAlert(
      MONITOR,
      'news',
      {
        id: 'n1',
        text: 't',
        title: 'Fortinet patches critical FortiOS flaw',
      },
      'fortinet',
    );
    expect(alert.headline).toBe('Fortinet exposure: Fortinet patches critical FortiOS flaw');
    expect(alert.summary).toContain('Fortinet exposure');
  });

  it('carries the monitor severity, not the item severity', () => {
    expect(
      buildMatchAlert(
        { name: 'w', severity: 'critical' },
        'kev',
        {
          id: 'k',
          text: 't',
          title: 'x',
        },
        'kw',
      ).severity,
    ).toBe('critical');
  });

  it('renders as a WATCHLIST row, not a generic advisory', () => {
    expect(
      buildMatchAlert(MONITOR, 'news', { id: 'n', text: 't', title: 'x' }, 'kw').alertType,
    ).toBe('monitor_match');
  });

  it('tags the entity with the feed it came from', () => {
    expect(
      buildMatchAlert(MONITOR, 'tweet', { id: 't1', text: 't', title: '@x' }, 'kw').entityKind,
    ).toBe('tweet');
  });

  it('skips the pipeline dedup — monitor_match_log is the authoritative gate', () => {
    // Two monitors matching the same article share an entity_id; the 24h
    // (alert_type, entity_kind, entity_id) guard would collapse them to one.
    const a = buildMatchAlert(
      { name: 'Watch A', severity: 'high' },
      'news',
      {
        id: 'n1',
        text: 't',
        title: 'shared story',
        url: 'https://example.com/story',
      },
      'shared',
    );
    const b = buildMatchAlert(
      { name: 'Watch B', severity: 'high' },
      'news',
      {
        id: 'n1',
        text: 't',
        title: 'shared story',
        url: 'https://example.com/story',
      },
      'shared',
    );

    expect(a.skipDedup).toBe(true);
    expect(b.skipDedup).toBe(true);
    expect(a.entityId).toBe(b.entityId);
    expect(a.headline).not.toBe(b.headline);
  });

  it('truncates a runaway headline rather than overflowing the column', () => {
    const alert = buildMatchAlert(
      MONITOR,
      'news',
      {
        id: 'n',
        text: 't',
        title: 'x'.repeat(500),
      },
      'kw',
    );
    expect(alert.headline.length).toBe(300);
  });
});

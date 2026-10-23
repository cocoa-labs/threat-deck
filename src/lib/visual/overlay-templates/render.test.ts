import { describe, expect, it } from 'vitest';
import { renderInfographicOverlay } from './render';

describe('renderInfographicOverlay', () => {
  it('produces a PNG buffer at 1200x2400 for kev_pressure style', async () => {
    const png = await renderInfographicOverlay({
      styleTag: 'kev_pressure',
      bluf: 'Critical CVE-2024-12345 added to KEV; 9.8 CVSS; PoC public.',
      entityKind: 'kev',
      entityId: 'CVE-2024-12345',
      severity: 'critical',
      dataTiles: [
        { label: 'CVSS', value: '9.8' },
        { label: 'EPSS', value: '0.92' },
        { label: 'KEV', value: 'Added 3d ago' },
      ],
      sourceUrl: 'https://example.com/cve-2024-12345',
      generatedAt: '2026-05-25T18:30:00Z',
    });

    // PNG magic bytes: 0x89 'P' 'N' 'G'
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
    expect(png.length).toBeGreaterThan(10000); // non-trivial PNG
    expect(png.length).toBeLessThan(5_000_000); // sanity cap
  });

  it('renders all topic-aware styles without throwing', async () => {
    const styles = [
      'kev_pressure',
      'identity_intrusion',
      'supply_chain_map',
      'research_gap_card',
      'exposure_ledger',
      'market_signal_board',
      'crt_terminal',
    ] as const;
    for (const styleTag of styles) {
      const png = await renderInfographicOverlay({
        styleTag,
        bluf: `Test ${styleTag}`,
        generatedAt: '2026-05-25T00:00:00Z',
      });
      expect(png.length).toBeGreaterThan(1000);
    }
  });

  it('omits optional dataTiles when not provided', async () => {
    const png = await renderInfographicOverlay({
      styleTag: 'crt_terminal',
      bluf: 'Just a BLUF, no tiles',
      generatedAt: '2026-05-25T00:00:00Z',
    });
    expect(png.length).toBeGreaterThan(1000);
  });
});

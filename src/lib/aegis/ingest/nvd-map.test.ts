import { describe, expect, it } from 'vitest';
import { mapSeverity, type NvdCve, nvdToCveRow, pickCwe, pickEnglish } from './nvd-map';

describe('mapSeverity', () => {
  it('prefers explicit severity string', () => {
    expect(mapSeverity('CRITICAL', 5)).toBe('critical');
  });
  it('falls back to score buckets', () => {
    expect(mapSeverity(undefined, 9.1)).toBe('critical');
    expect(mapSeverity(undefined, 7.0)).toBe('high');
    expect(mapSeverity(undefined, 4.0)).toBe('medium');
    expect(mapSeverity(undefined, 0.1)).toBe('low');
    expect(mapSeverity(undefined, null)).toBeNull();
  });
});

describe('pickEnglish', () => {
  it('returns the en description', () => {
    expect(
      pickEnglish([
        { lang: 'es', value: 'hola' },
        { lang: 'en', value: 'hi' },
      ]),
    ).toBe('hi');
  });
  it('returns null when none', () => {
    expect(pickEnglish(undefined)).toBeNull();
  });
});

describe('pickCwe', () => {
  it('returns first CWE- weakness', () => {
    expect(pickCwe([{ description: [{ lang: 'en', value: 'CWE-79' }] }])).toBe('CWE-79');
  });
  it('returns null when none', () => {
    expect(pickCwe(undefined)).toBeNull();
  });
});

describe('nvdToCveRow', () => {
  it('assembles the full row object and prefers V31 over V30', () => {
    const item: NvdCve = {
      id: 'CVE-2024-12345',
      published: '2024-03-01T00:00:00.000',
      lastModified: '2024-03-05T00:00:00.000',
      descriptions: [
        { lang: 'es', value: 'desbordamiento' },
        { lang: 'en', value: 'A buffer overflow.' },
      ],
      weaknesses: [{ description: [{ lang: 'en', value: 'CWE-120' }] }],
      metrics: {
        cvssMetricV31: [
          { cvssData: { baseScore: 9.8, vectorString: 'CVSS:3.1/AV:N', baseSeverity: 'CRITICAL' } },
        ],
        cvssMetricV30: [
          { cvssData: { baseScore: 5.0, vectorString: 'CVSS:3.0/AV:L', baseSeverity: 'MEDIUM' } },
        ],
      },
    };

    const row = nvdToCveRow(item);

    // (a) full shape / keys
    expect(Object.keys(row).sort()).toEqual(
      [
        'cveId',
        'publishedAt',
        'lastModifiedAt',
        'summary',
        'cweId',
        'score',
        'vector',
        'severity',
        'sourceUrl',
      ].sort(),
    );
    expect(row).toEqual({
      cveId: 'CVE-2024-12345',
      publishedAt: '2024-03-01T00:00:00.000',
      lastModifiedAt: '2024-03-05T00:00:00.000',
      summary: 'A buffer overflow.',
      cweId: 'CWE-120',
      // (b) V31 wins over V30 for score / vector / severity
      score: 9.8,
      vector: 'CVSS:3.1/AV:N',
      severity: 'critical',
      // (c) source URL format
      sourceUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-12345',
    });
  });
});

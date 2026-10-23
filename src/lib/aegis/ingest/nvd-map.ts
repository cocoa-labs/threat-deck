export type CveSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface NvdCve {
  id: string;
  published: string;
  lastModified: string;
  descriptions?: Array<{ lang: string; value: string }>;
  weaknesses?: Array<{ description?: Array<{ lang: string; value: string }> }>;
  metrics?: {
    cvssMetricV31?: Array<{
      cvssData: { baseScore?: number; vectorString?: string; baseSeverity?: string };
    }>;
    cvssMetricV30?: Array<{
      cvssData: { baseScore?: number; vectorString?: string; baseSeverity?: string };
    }>;
  };
}

export interface NvdResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  vulnerabilities: Array<{ cve: NvdCve }>;
}

export function mapSeverity(raw: string | undefined, score: number | null): CveSeverity | null {
  if (raw) {
    const s = raw.toLowerCase();
    if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s as CveSeverity;
  }
  if (score == null) return null;
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0) return 'low';
  return null;
}

export function pickEnglish(descriptions: NvdCve['descriptions']): string | null {
  if (!descriptions) return null;
  return descriptions.find((d) => d.lang === 'en')?.value ?? null;
}

export function pickCwe(weaknesses: NvdCve['weaknesses']): string | null {
  if (!weaknesses) return null;
  for (const w of weaknesses) {
    const en = w.description?.find((d) => d.lang === 'en');
    if (en?.value?.startsWith('CWE-')) return en.value;
  }
  return null;
}

/** Map a raw NVD CVE into a row object for the aegis_cves UPSERT. */
export function nvdToCveRow(item: NvdCve): {
  cveId: string;
  publishedAt: string;
  lastModifiedAt: string;
  summary: string | null;
  cweId: string | null;
  score: number | null;
  vector: string | null;
  severity: CveSeverity | null;
  sourceUrl: string;
} {
  const v31 = item.metrics?.cvssMetricV31?.[0];
  const v30 = item.metrics?.cvssMetricV30?.[0];
  const score = v31?.cvssData?.baseScore ?? v30?.cvssData?.baseScore ?? null;
  const vector = v31?.cvssData?.vectorString ?? v30?.cvssData?.vectorString ?? null;
  return {
    cveId: item.id,
    publishedAt: item.published,
    lastModifiedAt: item.lastModified,
    summary: pickEnglish(item.descriptions),
    cweId: pickCwe(item.weaknesses),
    score,
    vector,
    severity: mapSeverity(v31?.cvssData?.baseSeverity ?? v30?.cvssData?.baseSeverity, score),
    sourceUrl: `https://nvd.nist.gov/vuln/detail/${item.id}`,
  };
}

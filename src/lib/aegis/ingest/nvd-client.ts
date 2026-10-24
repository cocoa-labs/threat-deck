import { checkRateLimit, isBackedOff, setBackoff } from '@/lib/data/rate-limiter';
import { safeFetch } from '@/lib/security/safe-fetch';
import type { NvdCve, NvdResponse } from './nvd-map';

const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const PAGE_SIZE = 200;
const MAX_RESULTS = 10_000;

/** Return a complete, bounded window or fail without advancing its ingestion cursor. */
export async function fetchNvdWindow(startISO: string, endISO: string): Promise<NvdCve[]> {
  const out: NvdCve[] = [];
  let startIndex = 0;
  let total = -1;
  const headers: Record<string, string> = { 'User-Agent': 'cocoa-threat-deck/1.0' };
  if (process.env.NVD_API_KEY) headers.apiKey = process.env.NVD_API_KEY;

  while (total < 0 || startIndex < total) {
    if (isBackedOff('nvd')) throw new Error('nvd_rate_limited');
    if (!checkRateLimit('nvd')) {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      if (!checkRateLimit('nvd')) throw new Error('nvd_rate_limited');
    }
    const url = `${NVD_URL}?lastModStartDate=${encodeURIComponent(startISO)}&lastModEndDate=${encodeURIComponent(endISO)}&resultsPerPage=${PAGE_SIZE}&startIndex=${startIndex}`;
    const res = await safeFetch(url, { headers }, 16 * 1024 * 1024);
    if (!res.ok) {
      if (res.status === 429) setBackoff('nvd', 30 * 60_000);
      throw new Error(`nvd_http_${res.status}`);
    }
    const json = (await res.json()) as NvdResponse;
    if (
      !Number.isSafeInteger(json.totalResults) ||
      json.totalResults < 0 ||
      json.totalResults > MAX_RESULTS ||
      json.startIndex !== startIndex ||
      !Array.isArray(json.vulnerabilities) ||
      json.vulnerabilities.length > PAGE_SIZE
    )
      throw new Error('nvd_invalid_page');
    if (total < 0) total = json.totalResults;
    if (total !== json.totalResults) throw new Error('nvd_window_changed');
    const items = json.vulnerabilities.map((w) => w.cve);
    if (items.some((item) => !item || !/^CVE-\d{4}-\d{4,}$/.test(item.id)))
      throw new Error('nvd_invalid_cve');
    if (items.length === 0 && startIndex < total) throw new Error('nvd_incomplete_window');
    out.push(...items);
    if (out.length > total) throw new Error('nvd_invalid_page');
    startIndex += items.length;
    if (startIndex < total)
      await new Promise((r) => setTimeout(r, process.env.NVD_API_KEY ? 600 : 6500));
  }
  return out;
}

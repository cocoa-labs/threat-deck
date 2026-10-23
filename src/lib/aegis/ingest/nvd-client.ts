import type { NvdCve, NvdResponse } from './nvd-map';

const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const PAGE_SIZE = 2000;

/** Fetch all CVEs lastModified within [startISO, endISO]. Fail-soft: returns what it got. */
export async function fetchNvdWindow(startISO: string, endISO: string): Promise<NvdCve[]> {
  const out: NvdCve[] = [];
  let startIndex = 0;
  let total = -1;
  const headers: Record<string, string> = { 'User-Agent': 'cocoa-threat-deck/1.0' };
  if (process.env.NVD_API_KEY) headers.apiKey = process.env.NVD_API_KEY;

  while (total < 0 || startIndex < total) {
    const url = `${NVD_URL}?lastModStartDate=${encodeURIComponent(startISO)}&lastModEndDate=${encodeURIComponent(endISO)}&resultsPerPage=${PAGE_SIZE}&startIndex=${startIndex}`;
    let json: NvdResponse;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) break; // fail-soft; cursor not advanced, retried next run
      json = (await res.json()) as NvdResponse;
    } catch {
      break;
    }
    if (total < 0) total = json.totalResults ?? 0;
    const items = (json.vulnerabilities ?? []).map((w) => w.cve);
    out.push(...items);
    if (items.length === 0) break;
    startIndex += json.resultsPerPage ?? PAGE_SIZE;
    if (startIndex < total)
      await new Promise((r) => setTimeout(r, process.env.NVD_API_KEY ? 600 : 6500));
  }
  return out;
}

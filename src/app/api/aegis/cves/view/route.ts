import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { safeLink } from '@/lib/security/safe-link';

/**
 * GET /api/aegis/cves/view?id=CVE-2024-12345
 *
 * Returns a CRT-styled HTML page (Matrix green accent) with full CVE detail.
 * Used as the canonical link target for AEGIS CVE citations. Auto-closes after 5s.
 */
async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return NextResponse.json({ error: 'Missing required parameter: id' }, { status: 400 });
  }

  try {
    const cveResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_cves WHERE cve_id = $1`,
      [idParam],
    );

    if (cveResult.rows.length === 0) {
      return NextResponse.json({ error: `No CVE found with id ${idParam}` }, { status: 404 });
    }

    const cve = cveResult.rows[0]!;

    const productsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_affected_products WHERE cve_id = $1 ORDER BY vendor, product LIMIT 10`,
      [idParam],
    );

    const remediationsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_remediations WHERE cve_id = $1
       ORDER BY released_at DESC NULLS LAST LIMIT 8`,
      [idParam],
    );

    const kevResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_kev WHERE cve_id = $1`,
      [idParam],
    );
    const kev = kevResult.rows[0] ?? null;

    return new NextResponse(buildCveHtml(cve, productsResult.rows, remediationsResult.rows, kev), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    console.error('[aegis/cves/view] Error:', err);
    return NextResponse.json({ error: 'Failed to load CVE' }, { status: 500 });
  }
}

function severityColor(sev: string | null): string {
  switch ((sev ?? '').toLowerCase()) {
    case 'critical':
      return '#ff4444';
    case 'high':
      return '#ff8844';
    case 'medium':
      return '#ffaa00';
    case 'low':
      return '#00ff41';
    default:
      return '#888';
  }
}

function fmtScore(val: unknown): string {
  if (val == null) return 'N/A';
  const n = Number(val);
  if (Number.isNaN(n)) return 'N/A';
  return n.toFixed(1);
}

function fmtPctile(val: unknown): string {
  if (val == null) return 'N/A';
  const n = Number(val);
  if (Number.isNaN(n)) return 'N/A';
  return `${(n * 100).toFixed(0)}%`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safe(val: unknown): string {
  if (val == null) return 'N/A';
  return escapeHtml(String(val));
}

function buildCveHtml(
  cve: Record<string, unknown>,
  products: Record<string, unknown>[],
  remediations: Record<string, unknown>[],
  kev: Record<string, unknown> | null,
): string {
  const cveId = safe(cve.cve_id);
  const sev = String(cve.severity ?? 'unknown');
  const sc = severityColor(sev);
  const summary = safe(cve.summary);
  const cvssV3 = fmtScore(cve.cvss_v3_score);
  const cvssV4 = fmtScore(cve.cvss_v4_score);
  const epssScore = fmtScore(cve.epss_score);
  const epssPct = fmtPctile(cve.epss_percentile);
  const nvdUrl = cve.nvd_source_url
    ? escapeHtml(safeLink(cve.nvd_source_url))
    : `https://nvd.nist.gov/vuln/detail/${cveId}`;

  const productsHtml =
    products.length === 0
      ? '<div class="empty">No affected products listed</div>'
      : products
          .map(
            (p) =>
              `<div class="row">
                <span class="vendor">${safe(p.vendor)}</span>
                <span class="product">${safe(p.product)}</span>
                <span class="version">${safe(p.version_range_end ?? p.version_range_start)}</span>
              </div>`,
          )
          .join('');

  const remediationsHtml =
    remediations.length === 0
      ? '<div class="empty">No remediations published yet</div>'
      : remediations
          .map((r) => {
            const url = r.advisory_url ? String(r.advisory_url) : null;
            const label = `${safe(r.vendor ?? 'Advisory')} ${safe(r.advisory_id ?? '')}`.trim();
            return `<div class="row">
              ${url ? `<a href="${escapeHtml(safeLink(url))}" target="_blank" rel="noopener">${label}</a>` : `<span>${label}</span>`}
              <span class="version">${safe(r.patch_version)}</span>
              <span class="released">${safe(r.released_at)}</span>
            </div>`;
          })
          .join('');

  const kevBlock = kev
    ? `<div class="section kev-block">
        <div class="section-title">CISA KEV</div>
        <div class="grid">
          <div class="item"><span class="label">Added</span><span class="value">${safe(kev.added_to_kev_at)}</span></div>
          <div class="item"><span class="label">Due Date</span><span class="value">${safe(kev.due_date)}</span></div>
          <div class="item"><span class="label">Vendor</span><span class="value">${safe(kev.vendor_project)}</span></div>
          <div class="item"><span class="label">Product</span><span class="value">${safe(kev.product)}</span></div>
        </div>
        <div class="required-action">${safe(kev.required_action)}</div>
        ${kev.known_ransomware_use ? `<div class="ransom-note">Ransomware use: ${safe(kev.known_ransomware_use)}</div>` : ''}
      </div>`
    : '';

  const flags: string[] = [];
  if (cve.is_kev === true) flags.push('KEV');
  if (cve.exploited_in_wild === true) flags.push('EXPLOITED');
  if (cve.poc_public === true) flags.push('POC PUBLIC');
  const flagsHtml = flags.map((f) => `<span class="flag">${f}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AEGIS CVE &mdash; ${cveId}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e8e8e8;font-family:'Geist Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{border:1px solid rgba(0,255,65,0.3);border-radius:8px;padding:32px 40px;
    max-width:720px;width:100%;box-shadow:0 0 20px rgba(0,255,65,0.08)}
  h1{font-size:12px;color:#00ff41;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;text-align:center}
  .cve-id{font-size:22px;font-weight:700;text-align:center;margin-bottom:6px;color:#00ff41}
  .summary{font-size:12px;color:#bbb;text-align:center;margin-bottom:20px;line-height:1.5}
  .score-row{display:flex;align-items:center;justify-content:center;gap:24px;margin-bottom:14px}
  .score-box{text-align:center}
  .score-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}
  .score-value{font-size:24px;font-weight:700;color:#00ff41}
  .severity-badge{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;
    padding:4px 12px;border-radius:4px;border:2px solid}
  .flags{text-align:center;margin-bottom:20px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
  .flag{display:inline-block;font-size:9px;font-weight:700;letter-spacing:1px;color:#ff4444;
    border:1px solid #ff4444;padding:2px 8px;border-radius:3px}
  .section{margin-bottom:18px}
  .section-title{font-size:10px;color:#00ff41;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;
    border-bottom:1px solid rgba(0,255,65,0.15);padding-bottom:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
  .item{display:flex;justify-content:space-between;font-size:11px}
  .item .label{color:#888}
  .item .value{color:#e8e8e8;font-weight:500}
  .row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px;padding:4px 0;
    border-bottom:1px solid rgba(0,255,65,0.08)}
  .row a{color:#00ff41;text-decoration:none}
  .row a:hover{text-decoration:underline}
  .vendor{color:#00ff41;font-weight:500}
  .product,.released{color:#bbb}
  .version{color:#ffaa00}
  .empty{font-size:11px;color:#555;font-style:italic}
  .kev-block{border-left:3px solid #ff4444;padding-left:12px}
  .required-action{font-size:11px;color:#e8e8e8;margin-top:10px;padding:8px;
    background:rgba(255,68,68,0.05);border-radius:4px;line-height:1.5}
  .ransom-note{font-size:10px;color:#ff4444;margin-top:8px;font-weight:600}
  .links{text-align:center;margin-top:16px;display:flex;gap:12px;justify-content:center}
  .links a{color:#00ff41;font-size:11px;text-decoration:none;border:1px solid rgba(0,255,65,0.4);
    padding:6px 14px;border-radius:4px}
  .links a:hover{background:rgba(0,255,65,0.1)}
  .close-hint{font-size:10px;color:#555;text-align:center;margin-top:20px}
  button{display:block;margin:20px auto 0;background:transparent;border:1px solid rgba(0,255,65,0.4);color:#00ff41;
    font-family:inherit;font-size:11px;padding:8px 20px;border-radius:4px;cursor:pointer}
  button:hover{background:rgba(0,255,65,0.1)}
</style>
</head>
<body>
<div class="card">
  <h1>AEGIS CVE</h1>
  <div class="cve-id">${cveId}</div>
  <div class="summary">${summary.length > 200 ? `${summary.slice(0, 200)}&hellip;` : summary}</div>

  <div class="score-row">
    <div class="score-box">
      <div class="score-label">CVSS v3</div>
      <div class="score-value">${cvssV3}</div>
    </div>
    <div class="score-box">
      <div class="score-label">CVSS v4</div>
      <div class="score-value">${cvssV4}</div>
    </div>
    <div class="score-box">
      <div class="score-label">EPSS</div>
      <div class="score-value">${epssScore}</div>
    </div>
    <div class="score-box">
      <div class="score-label">EPSS %ile</div>
      <div class="score-value">${epssPct}</div>
    </div>
    <div class="severity-badge" style="color:${sc};border-color:${sc}">${escapeHtml(sev)}</div>
  </div>

  ${flags.length > 0 ? `<div class="flags">${flagsHtml}</div>` : ''}

  <div class="section">
    <div class="section-title">Metadata</div>
    <div class="grid">
      <div class="item"><span class="label">Published</span><span class="value">${safe(cve.published_at)}</span></div>
      <div class="item"><span class="label">Last Modified</span><span class="value">${safe(cve.last_modified_at)}</span></div>
      <div class="item"><span class="label">CWE</span><span class="value">${safe(cve.cwe_id)}</span></div>
      <div class="item"><span class="label">KEV Added</span><span class="value">${safe(cve.kev_added_date)}</span></div>
    </div>
  </div>

  ${kevBlock}

  <div class="section">
    <div class="section-title">Affected Products (${products.length})</div>
    ${productsHtml}
  </div>

  <div class="section">
    <div class="section-title">Remediations (${remediations.length})</div>
    ${remediationsHtml}
  </div>

  <div class="links">
    <a href="${nvdUrl}" target="_blank" rel="noopener">NVD &rarr;</a>
    <a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog" target="_blank" rel="noopener">CISA KEV &rarr;</a>
  </div>

  <button onclick="window.close()">Close Tab</button>
  <div class="close-hint">This tab will close automatically in 5 seconds</div>
</div>
<script>setTimeout(function(){window.close()},5000)</script>
</body>
</html>`;
}

export const GET = withRoutePolicy('/api/aegis/cves/view', routeGETImplementation);

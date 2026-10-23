import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { safeLink } from '@/lib/security/safe-link';

/**
 * GET /api/aegis/compromised-orgs/view?id=ORG_ID
 *
 * CRT-styled HTML page (Matrix green accent) showing org profile, breach history,
 * last breach date, total records compromised, ransom status. Auto-closes after 5s.
 */
async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return NextResponse.json({ error: 'Missing required parameter: id' }, { status: 400 });
  }

  const numId = Number(idParam);
  if (Number.isNaN(numId) || numId < 1) {
    return NextResponse.json({ error: `Invalid org id: ${idParam}` }, { status: 400 });
  }

  try {
    const orgResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_compromised_orgs WHERE id = $1`,
      [numId],
    );

    if (orgResult.rows.length === 0) {
      return NextResponse.json({ error: `No org found with id ${idParam}` }, { status: 404 });
    }

    const org = orgResult.rows[0]!;

    const disclosuresResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_breach_disclosures WHERE org_id = $1
       ORDER BY disclosed_at DESC LIMIT 10`,
      [numId],
    );

    return new NextResponse(buildOrgHtml(org, disclosuresResult.rows), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    console.error('[aegis/compromised-orgs/view] Error:', err);
    return NextResponse.json({ error: 'Failed to load org' }, { status: 500 });
  }
}

function fmtNum(val: unknown): string {
  if (val == null) return 'N/A';
  const n = Number(val);
  if (Number.isNaN(n)) return 'N/A';
  return n.toLocaleString('en-US');
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

function joinArr(val: unknown): string {
  if (!Array.isArray(val) || val.length === 0) return 'N/A';
  return escapeHtml(val.join(', '));
}

function buildOrgHtml(
  org: Record<string, unknown>,
  disclosures: Record<string, unknown>[],
): string {
  const name = safe(org.org_name);
  const domain = safe(org.org_domain);
  const industry = safe(org.industry);
  const country = safe(org.country);
  const hasRansom = org.has_active_ransom === true;

  const disclosuresHtml =
    disclosures.length === 0
      ? '<div class="empty">No disclosures on file</div>'
      : disclosures
          .map((d) => {
            const url = d.source_url ? String(d.source_url) : null;
            const sourceCell = url
              ? `<a href="${escapeHtml(safeLink(url))}" target="_blank" rel="noopener">${safe(d.source)}</a>`
              : `<span>${safe(d.source)}</span>`;
            const cves =
              Array.isArray(d.related_cve_ids) && (d.related_cve_ids as string[]).length > 0
                ? ` &middot; CVEs: ${joinArr(d.related_cve_ids)}`
                : '';
            return `<div class="disc-row">
              <div class="disc-head">
                <span class="disc-date">${safe(d.disclosed_at)}</span>
                <span class="disc-type">${safe(d.breach_type)}</span>
                <span class="disc-records">${fmtNum(d.records_compromised)} records</span>
              </div>
              <div class="disc-meta">Source: ${sourceCell} &middot; Quality: ${safe(d.attestation_quality)}${cves}</div>
            </div>`;
          })
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AEGIS Compromised Org &mdash; ${name}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e8e8e8;font-family:'Geist Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{border:1px solid rgba(0,255,65,0.3);border-radius:8px;padding:32px 40px;
    max-width:680px;width:100%;box-shadow:0 0 20px rgba(0,255,65,0.08)}
  h1{font-size:12px;color:#00ff41;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;text-align:center}
  .name{font-size:22px;font-weight:700;text-align:center;margin-bottom:4px;color:#00ff41}
  .domain{font-size:11px;color:#888;text-align:center;margin-bottom:18px}
  .impact-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px}
  .impact-box{text-align:center;border:1px solid rgba(0,255,65,0.15);border-radius:4px;padding:12px}
  .impact-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .impact-value{font-size:18px;font-weight:700;color:#00ff41}
  .ransom-banner{text-align:center;margin-bottom:20px;padding:8px;background:rgba(255,68,68,0.1);
    border:1px solid #ff4444;border-radius:4px;color:#ff4444;font-size:11px;font-weight:700;
    letter-spacing:1px;text-transform:uppercase}
  .section{margin-bottom:18px}
  .section-title{font-size:10px;color:#00ff41;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;
    border-bottom:1px solid rgba(0,255,65,0.15);padding-bottom:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
  .item{display:flex;justify-content:space-between;font-size:11px}
  .item .label{color:#888}
  .item .value{color:#e8e8e8;font-weight:500}
  .disc-row{padding:8px 0;border-bottom:1px solid rgba(0,255,65,0.08)}
  .disc-head{display:grid;grid-template-columns:90px 110px 1fr;gap:8px;font-size:11px;margin-bottom:3px}
  .disc-date{color:#888}
  .disc-type{color:#ffaa00;font-weight:500}
  .disc-records{color:#00ff41;font-weight:600;text-align:right}
  .disc-meta{font-size:10px;color:#bbb}
  .disc-meta a{color:#00ff41;text-decoration:none}
  .disc-meta a:hover{text-decoration:underline}
  .empty{font-size:11px;color:#555;font-style:italic}
  .close-hint{font-size:10px;color:#555;text-align:center;margin-top:20px}
  button{display:block;margin:20px auto 0;background:transparent;border:1px solid rgba(0,255,65,0.4);color:#00ff41;
    font-family:inherit;font-size:11px;padding:8px 20px;border-radius:4px;cursor:pointer}
  button:hover{background:rgba(0,255,65,0.1)}
</style>
</head>
<body>
<div class="card">
  <h1>AEGIS Compromised Org</h1>
  <div class="name">${name}</div>
  <div class="domain">${domain} &middot; ${industry} &middot; ${country}${org.state_region ? ` &middot; ${safe(org.state_region)}` : ''}</div>

  ${hasRansom ? '<div class="ransom-banner">&#9888; Active Ransom Status</div>' : ''}

  <div class="impact-row">
    <div class="impact-box">
      <div class="impact-label">Total Breaches</div>
      <div class="impact-value">${fmtNum(org.breach_count)}</div>
    </div>
    <div class="impact-box">
      <div class="impact-label">Records Compromised</div>
      <div class="impact-value">${fmtNum(org.total_records_compromised)}</div>
    </div>
    <div class="impact-box">
      <div class="impact-label">Last Breach</div>
      <div class="impact-value" style="font-size:13px">${safe(org.last_breach_at)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Enrichment Status</div>
    <div class="grid">
      <div class="item"><span class="label">Status</span><span class="value">${safe(org.enrichment_status)}</span></div>
      <div class="item"><span class="label">Source</span><span class="value">${safe(org.enrichment_source)}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Breach History (${disclosures.length})</div>
    ${disclosuresHtml}
  </div>

  <button onclick="window.close()">Close Tab</button>
  <div class="close-hint">This tab will close automatically in 5 seconds</div>
</div>
<script>setTimeout(function(){window.close()},5000)</script>
</body>
</html>`;
}

export const GET = withRoutePolicy('/api/aegis/compromised-orgs/view', routeGETImplementation);

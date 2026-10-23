import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/kev/view?id=CVE-2024-12345
 *
 * CRT-styled HTML page (Matrix green accent) showing CISA KEV entry:
 * CVE, vulnerability name, vendor, due date, required action, ransomware use.
 * Auto-closes after 5s.
 */
async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return NextResponse.json({ error: 'Missing required parameter: id' }, { status: 400 });
  }

  try {
    const kevResult = await query<Record<string, unknown>>(
      `SELECT k.*, c.severity, c.cvss_v3_score, c.epss_score, c.summary AS cve_summary
       FROM aegis_kev k
       JOIN aegis_cves c ON c.cve_id = k.cve_id
       WHERE k.cve_id = $1`,
      [idParam],
    );

    if (kevResult.rows.length === 0) {
      return NextResponse.json({ error: `No KEV entry found for ${idParam}` }, { status: 404 });
    }

    const kev = kevResult.rows[0]!;

    return new NextResponse(buildKevHtml(kev), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    console.error('[aegis/kev/view] Error:', err);
    return NextResponse.json({ error: 'Failed to load KEV entry' }, { status: 500 });
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

function daysUntil(dateStr: string | null): { days: number | null; label: string; color: string } {
  if (!dateStr) return { days: null, label: 'No deadline', color: '#888' };
  const due = new Date(dateStr);
  if (Number.isNaN(due.getTime())) return { days: null, label: 'Invalid date', color: '#888' };
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return { days, label: `${Math.abs(days)} days overdue`, color: '#ff4444' };
  if (days === 0) return { days, label: 'Due today', color: '#ff4444' };
  if (days <= 7) return { days, label: `${days} days remaining`, color: '#ff8844' };
  if (days <= 30) return { days, label: `${days} days remaining`, color: '#ffaa00' };
  return { days, label: `${days} days remaining`, color: '#00ff41' };
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

function buildKevHtml(kev: Record<string, unknown>): string {
  const cveId = safe(kev.cve_id);
  const vulnName = safe(kev.vulnerability_name);
  const sev = String(kev.severity ?? 'unknown');
  const sc = severityColor(sev);
  const deadline = daysUntil(kev.due_date as string | null);
  const ransomware = kev.known_ransomware_use;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AEGIS KEV &mdash; ${cveId}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e8e8e8;font-family:'Geist Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{border:1px solid rgba(0,255,65,0.3);border-radius:8px;padding:32px 40px;
    max-width:600px;width:100%;box-shadow:0 0 20px rgba(0,255,65,0.08)}
  h1{font-size:12px;color:#00ff41;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;text-align:center}
  .cve-id{font-size:20px;font-weight:700;text-align:center;margin-bottom:4px;color:#00ff41}
  .vuln-name{font-size:13px;color:#bbb;text-align:center;margin-bottom:18px;line-height:1.4}
  .deadline-banner{text-align:center;margin-bottom:20px;padding:12px;border:2px solid;border-radius:6px}
  .deadline-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px;color:#888}
  .deadline-value{font-size:20px;font-weight:700}
  .deadline-date{font-size:11px;color:#888;margin-top:4px}
  .sev-row{text-align:center;margin-bottom:20px;display:flex;gap:8px;justify-content:center}
  .badge{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;
    padding:3px 10px;border-radius:3px;border:1px solid}
  .section{margin-bottom:18px}
  .section-title{font-size:10px;color:#00ff41;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;
    border-bottom:1px solid rgba(0,255,65,0.15);padding-bottom:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
  .item{display:flex;justify-content:space-between;font-size:11px}
  .item .label{color:#888}
  .item .value{color:#e8e8e8;font-weight:500}
  .required-action{font-size:12px;color:#e8e8e8;padding:12px;background:rgba(255,68,68,0.08);
    border-left:3px solid #ff4444;border-radius:0 4px 4px 0;line-height:1.5}
  .ransom-block{font-size:11px;color:#ff4444;padding:10px;background:rgba(255,68,68,0.06);
    border:1px solid #ff4444;border-radius:4px;font-weight:600;text-align:center;margin-top:10px}
  .summary{font-size:11px;color:#bbb;line-height:1.5;margin-top:10px;font-style:italic}
  .links{text-align:center;margin-top:16px}
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
  <h1>CISA KEV Entry</h1>
  <div class="cve-id">${cveId}</div>
  <div class="vuln-name">${vulnName}</div>

  <div class="deadline-banner" style="border-color:${deadline.color}">
    <div class="deadline-label">Remediation Deadline</div>
    <div class="deadline-value" style="color:${deadline.color}">${escapeHtml(deadline.label)}</div>
    <div class="deadline-date">Due: ${safe(kev.due_date)}</div>
  </div>

  <div class="sev-row">
    <span class="badge" style="color:${sc};border-color:${sc}">${escapeHtml(sev)}</span>
    ${kev.cvss_v3_score ? `<span class="badge" style="color:#00ff41;border-color:#00ff41">CVSS ${escapeHtml(String(kev.cvss_v3_score))}</span>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Affected</div>
    <div class="grid">
      <div class="item"><span class="label">Vendor</span><span class="value">${safe(kev.vendor_project)}</span></div>
      <div class="item"><span class="label">Product</span><span class="value">${safe(kev.product)}</span></div>
      <div class="item"><span class="label">Added to KEV</span><span class="value">${safe(kev.added_to_kev_at)}</span></div>
      <div class="item"><span class="label">Due Date</span><span class="value">${safe(kev.due_date)}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Required Action</div>
    <div class="required-action">${safe(kev.required_action)}</div>
    ${ransomware ? `<div class="ransom-block">Known ransomware use: ${safe(ransomware)}</div>` : ''}
  </div>

  ${
    kev.short_description || kev.cve_summary
      ? `<div class="section">
          <div class="section-title">Description</div>
          <div class="summary">${safe(kev.short_description ?? kev.cve_summary)}</div>
        </div>`
      : ''
  }

  <div class="links">
    <a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog" target="_blank" rel="noopener">CISA KEV Catalog &rarr;</a>
  </div>

  <button id="close-viewer">Close Tab</button>
  <div class="close-hint">This tab will close automatically in 5 seconds</div>
</div>
<script src="/scripts/aegis-viewer.js" defer></script>
</body>
</html>`;
}

export const GET = withRoutePolicy('/api/aegis/kev/view', routeGETImplementation);

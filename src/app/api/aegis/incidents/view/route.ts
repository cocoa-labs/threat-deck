import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/incidents/view?id=INC_ID
 *
 * CRT-styled HTML page (Matrix green accent) with incident details, attribution,
 * and TTPs observed. Auto-closes after 5s.
 */
async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return NextResponse.json({ error: 'Missing required parameter: id' }, { status: 400 });
  }

  // Try numeric id first, then incident_id text
  const numId = Number(idParam);
  const useNumeric = !Number.isNaN(numId) && numId > 0;

  try {
    const incResult = await query<Record<string, unknown>>(
      useNumeric
        ? `SELECT i.*, a.display_name AS actor_name, a.actor_type, a.attribution_country
           FROM aegis_incidents i
           LEFT JOIN aegis_threat_actors a ON a.actor_id = i.actor_id
           WHERE i.id = $1`
        : `SELECT i.*, a.display_name AS actor_name, a.actor_type, a.attribution_country
           FROM aegis_incidents i
           LEFT JOIN aegis_threat_actors a ON a.actor_id = i.actor_id
           WHERE i.incident_id = $1`,
      [useNumeric ? numId : idParam],
    );

    if (incResult.rows.length === 0) {
      return NextResponse.json({ error: `No incident found with id ${idParam}` }, { status: 404 });
    }

    const incident = incResult.rows[0]!;

    const ttpsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_incident_ttps_observed WHERE incident_id = $1
       ORDER BY mitre_tactic_id ASC LIMIT 20`,
      [incident.id],
    );

    const attrsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_incident_attributes WHERE incident_id = $1 LIMIT 10`,
      [incident.id],
    );

    return new NextResponse(buildIncidentHtml(incident, ttpsResult.rows, attrsResult.rows), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    console.error('[aegis/incidents/view] Error:', err);
    return NextResponse.json({ error: 'Failed to load incident' }, { status: 500 });
  }
}

function incidentTypeColor(type: string | null): string {
  switch ((type ?? '').toLowerCase()) {
    case 'ransomware':
    case 'wiper':
    case 'zero_day':
      return '#ff4444';
    case 'data_breach':
    case 'supply_chain':
      return '#ff8844';
    case 'credential_stuffing':
    case 'phishing':
      return '#ffaa00';
    case 'ddos':
      return '#00ff41';
    default:
      return '#888';
  }
}

function fmtNum(val: unknown): string {
  if (val == null) return 'N/A';
  const n = Number(val);
  if (Number.isNaN(n)) return 'N/A';
  return n.toLocaleString('en-US');
}

function fmtMoney(val: unknown): string {
  if (val == null) return 'N/A';
  const n = Number(val);
  if (Number.isNaN(n)) return 'N/A';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString('en-US')}`;
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

function buildIncidentHtml(
  incident: Record<string, unknown>,
  ttps: Record<string, unknown>[],
  attrs: Record<string, unknown>[],
): string {
  const org = safe(incident.organization);
  const incidentType = String(incident.incident_type ?? 'unknown');
  const tc = incidentTypeColor(incidentType);
  const incId = safe(incident.incident_id ?? incident.id);

  const ttpsHtml =
    ttps.length === 0
      ? '<div class="empty">No TTPs observed</div>'
      : ttps
          .map(
            (t) =>
              `<div class="ttp-row">
                <span class="tactic">${safe(t.mitre_tactic_id)}</span>
                <span class="technique">${safe(t.mitre_technique_id)}</span>
                <span class="evidence">${safe(t.evidence_summary)}</span>
              </div>`,
          )
          .join('');

  const attrsHtml =
    attrs.length === 0
      ? ''
      : `<div class="section">
          <div class="section-title">Attributes</div>
          ${attrs
            .map(
              (a) =>
                `<div class="item">
                  <span class="label">${safe(a.attribute_type)}</span>
                  <span class="value">${safe(a.value_numeric ?? a.value_text)}</span>
                </div>`,
            )
            .join('')}
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AEGIS Incident &mdash; ${org}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e8e8e8;font-family:'Geist Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{border:1px solid rgba(0,255,65,0.3);border-radius:8px;padding:32px 40px;
    max-width:680px;width:100%;box-shadow:0 0 20px rgba(0,255,65,0.08)}
  h1{font-size:12px;color:#00ff41;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;text-align:center}
  .org{font-size:22px;font-weight:700;text-align:center;margin-bottom:4px;color:#00ff41}
  .inc-id{font-size:11px;color:#888;text-align:center;margin-bottom:18px}
  .type-row{text-align:center;margin-bottom:20px}
  .type-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;
    padding:4px 12px;border-radius:4px;border:2px solid}
  .summary{font-size:12px;color:#bbb;text-align:center;margin-bottom:20px;line-height:1.5;font-style:italic}
  .impact-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
  .impact-box{text-align:center;border:1px solid rgba(0,255,65,0.15);border-radius:4px;padding:12px}
  .impact-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .impact-value{font-size:18px;font-weight:700;color:#00ff41}
  .section{margin-bottom:18px}
  .section-title{font-size:10px;color:#00ff41;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;
    border-bottom:1px solid rgba(0,255,65,0.15);padding-bottom:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
  .item{display:flex;justify-content:space-between;font-size:11px}
  .item .label{color:#888}
  .item .value{color:#e8e8e8;font-weight:500}
  .ttp-row{display:grid;grid-template-columns:80px 100px 1fr;gap:8px;font-size:10px;padding:4px 0;
    border-bottom:1px solid rgba(0,255,65,0.08)}
  .tactic{color:#ffaa00;font-weight:500}
  .technique{color:#00ff41;font-weight:500}
  .evidence{color:#bbb}
  .empty{font-size:11px;color:#555;font-style:italic}
  .close-hint{font-size:10px;color:#555;text-align:center;margin-top:20px}
  button{display:block;margin:20px auto 0;background:transparent;border:1px solid rgba(0,255,65,0.4);color:#00ff41;
    font-family:inherit;font-size:11px;padding:8px 20px;border-radius:4px;cursor:pointer}
  button:hover{background:rgba(0,255,65,0.1)}
</style>
</head>
<body>
<div class="card">
  <h1>AEGIS Incident</h1>
  <div class="org">${org}</div>
  <div class="inc-id">${incId} &middot; ${safe(incident.industry)} &middot; ${safe(incident.country)}</div>

  <div class="type-row">
    <span class="type-badge" style="color:${tc};border-color:${tc}">${escapeHtml(incidentType.replace('_', ' '))}</span>
  </div>

  ${incident.summary ? `<div class="summary">${safe(incident.summary)}</div>` : ''}

  <div class="impact-row">
    <div class="impact-box">
      <div class="impact-label">Records Compromised</div>
      <div class="impact-value">${fmtNum(incident.records_compromised)}</div>
    </div>
    <div class="impact-box">
      <div class="impact-label">Estimated Loss</div>
      <div class="impact-value">${fmtMoney(incident.estimated_loss_usd)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Timeline</div>
    <div class="grid">
      <div class="item"><span class="label">Disclosed</span><span class="value">${safe(incident.disclosed_at)}</span></div>
      <div class="item"><span class="label">Started</span><span class="value">${safe(incident.incident_started_at)}</span></div>
      <div class="item"><span class="label">Ended</span><span class="value">${safe(incident.incident_ended_at)}</span></div>
      <div class="item"><span class="label">Initial Access</span><span class="value">${safe(incident.initial_access_vector)}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Attribution</div>
    <div class="grid">
      <div class="item"><span class="label">Actor</span><span class="value">${safe(incident.actor_name)}</span></div>
      <div class="item"><span class="label">Actor Type</span><span class="value">${safe(incident.actor_type)}</span></div>
      <div class="item"><span class="label">Origin</span><span class="value">${safe(incident.attribution_country)}</span></div>
      <div class="item"><span class="label">Actor ID</span><span class="value">${safe(incident.actor_id)}</span></div>
    </div>
  </div>

  ${attrsHtml}

  <div class="section">
    <div class="section-title">TTPs Observed (${ttps.length})</div>
    ${ttpsHtml}
  </div>

  <button id="close-viewer">Close Tab</button>
  <div class="close-hint">This tab will close automatically in 5 seconds</div>
</div>
<script src="/scripts/aegis-viewer.js" defer></script>
</body>
</html>`;
}

export const GET = withRoutePolicy('/api/aegis/incidents/view', routeGETImplementation);

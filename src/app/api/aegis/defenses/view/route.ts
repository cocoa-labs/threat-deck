import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { safeLink } from '@/lib/security/safe-link';

/**
 * GET /api/aegis/defenses/view?id=DEFENSE_ID
 *
 * CRT-styled HTML page (Matrix green accent) showing defense control details:
 * type, vendor, cost tier, frameworks satisfied, mitigations covered.
 * Auto-closes after 5s.
 */
async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return NextResponse.json({ error: 'Missing required parameter: id' }, { status: 400 });
  }

  // Try numeric id first, then defense_id text
  const numId = Number(idParam);
  const useNumeric = !Number.isNaN(numId) && numId > 0;

  try {
    const defResult = await query<Record<string, unknown>>(
      useNumeric
        ? `SELECT * FROM aegis_defenses WHERE id = $1`
        : `SELECT * FROM aegis_defenses WHERE defense_id = $1`,
      [useNumeric ? numId : idParam],
    );

    if (defResult.rows.length === 0) {
      return NextResponse.json({ error: `No defense found with id ${idParam}` }, { status: 404 });
    }

    const defense = defResult.rows[0]!;

    const mappingsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_defense_mappings WHERE defense_id = $1
       ORDER BY efficacy_score DESC NULLS LAST LIMIT 20`,
      [defense.id],
    );

    const charsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_defense_characteristics WHERE defense_id = $1`,
      [defense.id],
    );

    return new NextResponse(buildDefenseHtml(defense, mappingsResult.rows, charsResult.rows), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    console.error('[aegis/defenses/view] Error:', err);
    return NextResponse.json({ error: 'Failed to load defense' }, { status: 500 });
  }
}

function costColor(tier: string | null): string {
  switch ((tier ?? '').toLowerCase()) {
    case 'free':
      return '#00ff41';
    case 'low':
      return '#88ff44';
    case 'mid':
      return '#ffaa00';
    case 'high':
      return '#ff8844';
    default:
      return '#888';
  }
}

function efficacyColor(val: unknown): string {
  if (val == null) return '#888';
  const n = Number(val);
  if (Number.isNaN(n)) return '#888';
  if (n >= 0.8) return '#00ff41';
  if (n >= 0.6) return '#88ff44';
  if (n >= 0.4) return '#ffaa00';
  return '#ff8844';
}

function fmtEfficacy(val: unknown): string {
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

function joinArr(val: unknown): string {
  if (!Array.isArray(val) || val.length === 0) return 'N/A';
  return escapeHtml(val.join(', '));
}

function buildDefenseHtml(
  defense: Record<string, unknown>,
  mappings: Record<string, unknown>[],
  chars: Record<string, unknown>[],
): string {
  const name = safe(defense.name);
  const type = safe(defense.defense_type);
  const vendor = safe(defense.vendor);
  const costTier = String(defense.cost_tier ?? 'unknown');
  const cc = costColor(costTier);

  const mappingsHtml =
    mappings.length === 0
      ? '<div class="empty">No mappings recorded</div>'
      : mappings
          .map((m) => {
            const ec = efficacyColor(m.efficacy_score);
            const url = m.evidence_url ? String(m.evidence_url) : null;
            const targetCell = url
              ? `<a href="${escapeHtml(safeLink(url))}" target="_blank" rel="noopener">${safe(m.target_id)}</a>`
              : `<span>${safe(m.target_id)}</span>`;
            return `<div class="map-row">
              <span class="map-type">${safe(m.mapping_type)}</span>
              <span class="map-target">${targetCell}</span>
              <span class="map-eff" style="color:${ec}">${fmtEfficacy(m.efficacy_score)}</span>
            </div>`;
          })
          .join('');

  const charsHtml =
    chars.length === 0
      ? ''
      : `<div class="section">
          <div class="section-title">Characteristics</div>
          ${chars
            .map(
              (c) =>
                `<div class="item">
                  <span class="label">${safe(c.characteristic_type)}</span>
                  <span class="value">${safe(c.value_numeric ?? c.value_text)}</span>
                </div>`,
            )
            .join('')}
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AEGIS Defense &mdash; ${name}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e8e8e8;font-family:'Geist Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{border:1px solid rgba(0,255,65,0.3);border-radius:8px;padding:32px 40px;
    max-width:680px;width:100%;box-shadow:0 0 20px rgba(0,255,65,0.08)}
  h1{font-size:12px;color:#00ff41;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;text-align:center}
  .name{font-size:20px;font-weight:700;text-align:center;margin-bottom:4px;color:#00ff41}
  .meta{font-size:11px;color:#888;text-align:center;margin-bottom:18px}
  .badges{text-align:center;margin-bottom:20px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
  .badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;
    padding:3px 10px;border-radius:3px;border:1px solid}
  .summary{font-size:11px;color:#bbb;text-align:center;margin-bottom:20px;line-height:1.5}
  .section{margin-bottom:18px}
  .section-title{font-size:10px;color:#00ff41;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;
    border-bottom:1px solid rgba(0,255,65,0.15);padding-bottom:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
  .item{display:flex;justify-content:space-between;font-size:11px}
  .item .label{color:#888}
  .item .value{color:#e8e8e8;font-weight:500}
  .frameworks{font-size:11px;color:#bbb;line-height:1.6}
  .map-row{display:grid;grid-template-columns:120px 1fr 70px;gap:8px;font-size:11px;padding:4px 0;
    border-bottom:1px solid rgba(0,255,65,0.08)}
  .map-row a{color:#00ff41;text-decoration:none}
  .map-row a:hover{text-decoration:underline}
  .map-type{color:#ffaa00;font-weight:500;font-size:10px}
  .map-target{color:#bbb}
  .map-eff{text-align:right;font-weight:700}
  .empty{font-size:11px;color:#555;font-style:italic}
  .close-hint{font-size:10px;color:#555;text-align:center;margin-top:20px}
  button{display:block;margin:20px auto 0;background:transparent;border:1px solid rgba(0,255,65,0.4);color:#00ff41;
    font-family:inherit;font-size:11px;padding:8px 20px;border-radius:4px;cursor:pointer}
  button:hover{background:rgba(0,255,65,0.1)}
</style>
</head>
<body>
<div class="card">
  <h1>AEGIS Defense</h1>
  <div class="name">${name}</div>
  <div class="meta">${type} &middot; ${vendor} &middot; ${safe(defense.deployment_target)}</div>

  <div class="badges">
    <span class="badge" style="color:${cc};border-color:${cc}">${escapeHtml(costTier)} cost</span>
    <span class="badge" style="color:#00ff41;border-color:#00ff41">${safe(defense.complexity_tier)} complexity</span>
  </div>

  ${defense.summary ? `<div class="summary">${safe(defense.summary)}</div>` : ''}

  <div class="section">
    <div class="section-title">Frameworks Satisfied</div>
    <div class="frameworks">${joinArr(defense.frameworks)}</div>
  </div>

  ${charsHtml}

  <div class="section">
    <div class="section-title">Mitigations Covered (${mappings.length})</div>
    ${mappingsHtml}
  </div>

  <button onclick="window.close()">Close Tab</button>
  <div class="close-hint">This tab will close automatically in 5 seconds</div>
</div>
<script>setTimeout(function(){window.close()},5000)</script>
</body>
</html>`;
}

export const GET = withRoutePolicy('/api/aegis/defenses/view', routeGETImplementation);

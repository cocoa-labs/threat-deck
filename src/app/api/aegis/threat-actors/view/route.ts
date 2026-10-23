import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/threat-actors/view?id=ACTOR_ID
 *
 * CRT-styled HTML page (Matrix green accent) with actor profile, scores,
 * recent campaigns, and TTP coverage. Auto-closes after 5s.
 */
async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');

  if (!idParam) {
    return NextResponse.json({ error: 'Missing required parameter: id' }, { status: 400 });
  }

  try {
    const actorResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_threat_actors WHERE actor_id = $1`,
      [idParam],
    );

    if (actorResult.rows.length === 0) {
      return NextResponse.json(
        { error: `No threat actor found with id ${idParam}` },
        { status: 404 },
      );
    }

    const actor = actorResult.rows[0]!;

    const scoresResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_threat_actor_scores WHERE actor_id = $1`,
      [idParam],
    );
    const scores = scoresResult.rows[0] ?? null;

    const campaignsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_threat_actor_campaigns WHERE actor_id = $1
       ORDER BY start_date DESC NULLS LAST LIMIT 5`,
      [idParam],
    );

    const ttpsByTacticResult = await query<Record<string, unknown>>(
      `SELECT mitre_tactic_id, COUNT(*) AS technique_count
       FROM aegis_threat_actor_ttps WHERE actor_id = $1
       GROUP BY mitre_tactic_id ORDER BY technique_count DESC`,
      [idParam],
    );

    return new NextResponse(
      buildActorHtml(actor, scores, campaignsResult.rows, ttpsByTacticResult.rows),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  } catch (err) {
    console.error('[aegis/threat-actors/view] Error:', err);
    return NextResponse.json({ error: 'Failed to load threat actor' }, { status: 500 });
  }
}

function gradeColor(grade: string | null): string {
  switch (grade) {
    case 'A':
      return '#ff4444';
    case 'B':
      return '#ff8844';
    case 'C':
      return '#ffaa00';
    case 'D':
      return '#00ff41';
    default:
      return '#888';
  }
}

function fmtScore(val: unknown): string {
  if (val == null) return '--';
  const n = Number(val);
  if (Number.isNaN(n)) return '--';
  return n.toFixed(1);
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

function buildActorHtml(
  actor: Record<string, unknown>,
  scores: Record<string, unknown> | null,
  campaigns: Record<string, unknown>[],
  ttps: Record<string, unknown>[],
): string {
  const name = safe(actor.display_name);
  const actorId = safe(actor.actor_id);
  const composite = fmtScore(scores?.composite_score);
  const grade = String(scores?.actor_grade ?? '--');
  const gc = gradeColor(grade);
  const aliases = joinArr(actor.aliases);

  const campaignsHtml =
    campaigns.length === 0
      ? '<div class="empty">No campaigns recorded</div>'
      : campaigns
          .map(
            (c) =>
              `<div class="campaign">
                <div class="cname">${safe(c.campaign_name)}</div>
                <div class="cdates">${safe(c.start_date)} &ndash; ${c.end_date ? safe(c.end_date) : 'ongoing'}</div>
                <div class="csectors">Sectors: ${joinArr(c.target_sectors)}</div>
              </div>`,
          )
          .join('');

  const ttpsHtml =
    ttps.length === 0
      ? '<div class="empty">No TTPs mapped</div>'
      : ttps
          .map(
            (t) =>
              `<div class="ttp-row">
                <span class="tactic">${safe(t.mitre_tactic_id)}</span>
                <span class="tcount">${safe(t.technique_count)} techniques</span>
              </div>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AEGIS Threat Actor &mdash; ${name}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e8e8e8;font-family:'Geist Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{border:1px solid rgba(0,255,65,0.3);border-radius:8px;padding:32px 40px;
    max-width:680px;width:100%;box-shadow:0 0 20px rgba(0,255,65,0.08)}
  h1{font-size:12px;color:#00ff41;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;text-align:center}
  .name{font-size:22px;font-weight:700;text-align:center;margin-bottom:4px;color:#00ff41}
  .actor-id{font-size:11px;color:#888;text-align:center;margin-bottom:6px}
  .aliases{font-size:10px;color:#666;text-align:center;margin-bottom:18px;font-style:italic}
  .score-row{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:20px}
  .score-value{font-size:36px;font-weight:700;color:#00ff41}
  .grade-badge{font-size:24px;font-weight:700;padding:4px 14px;border-radius:6px;border:2px solid}
  .section{margin-bottom:20px}
  .section-title{font-size:10px;color:#00ff41;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;
    border-bottom:1px solid rgba(0,255,65,0.15);padding-bottom:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
  .item{display:flex;justify-content:space-between;font-size:11px}
  .item .label{color:#888}
  .item .value{color:#e8e8e8;font-weight:500}
  .dim-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px}
  .dim-box{text-align:center;border:1px solid rgba(0,255,65,0.15);border-radius:4px;padding:8px 4px}
  .dim-label{font-size:8px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .dim-value{font-size:18px;font-weight:700;color:#00ff41}
  .campaign{border:1px solid rgba(0,255,65,0.12);border-radius:4px;padding:8px 12px;margin-bottom:6px}
  .cname{font-size:12px;font-weight:600;color:#00ff41;margin-bottom:2px}
  .cdates{font-size:10px;color:#888;margin-bottom:2px}
  .csectors{font-size:10px;color:#bbb}
  .ttp-row{display:flex;justify-content:space-between;font-size:11px;padding:3px 0}
  .tactic{color:#ffaa00;font-weight:500}
  .tcount{color:#bbb}
  .empty{font-size:11px;color:#555;font-style:italic}
  .close-hint{font-size:10px;color:#555;text-align:center;margin-top:20px}
  button{display:block;margin:20px auto 0;background:transparent;border:1px solid rgba(0,255,65,0.4);color:#00ff41;
    font-family:inherit;font-size:11px;padding:8px 20px;border-radius:4px;cursor:pointer}
  button:hover{background:rgba(0,255,65,0.1)}
</style>
</head>
<body>
<div class="card">
  <h1>AEGIS Threat Actor</h1>
  <div class="name">${name}</div>
  <div class="actor-id">${actorId} &middot; ${safe(actor.actor_type)} &middot; ${safe(actor.attribution_country)}</div>
  ${actor.aliases && (actor.aliases as string[]).length > 0 ? `<div class="aliases">aka ${aliases}</div>` : ''}

  <div class="score-row">
    <div class="score-value">${composite}</div>
    <div class="grade-badge" style="color:${gc};border-color:${gc}">${escapeHtml(grade)}</div>
  </div>

  ${
    scores
      ? `<div class="section">
    <div class="section-title">Dimension Scores</div>
    <div class="dim-grid">
      <div class="dim-box"><div class="dim-label">Capability</div><div class="dim-value">${fmtScore(scores.capability_score)}</div></div>
      <div class="dim-box"><div class="dim-label">Reach</div><div class="dim-value">${fmtScore(scores.reach_score)}</div></div>
      <div class="dim-box"><div class="dim-label">Recency</div><div class="dim-value">${fmtScore(scores.recency_score)}</div></div>
      <div class="dim-box"><div class="dim-label">Velocity</div><div class="dim-value">${fmtScore(scores.velocity_score)}</div></div>
      <div class="dim-box"><div class="dim-label">Attribution</div><div class="dim-value">${fmtScore(scores.attribution_confidence)}</div></div>
    </div>
  </div>`
      : ''
  }

  <div class="section">
    <div class="section-title">Profile</div>
    <div class="grid">
      <div class="item"><span class="label">Motivation</span><span class="value">${safe(actor.motivation)}</span></div>
      <div class="item"><span class="label">Sophistication</span><span class="value">${safe(actor.sophistication)}</span></div>
      <div class="item"><span class="label">First Observed</span><span class="value">${safe(actor.first_observed_at)}</span></div>
      <div class="item"><span class="label">Last Active</span><span class="value">${safe(actor.last_active_at)}</span></div>
      <div class="item"><span class="label">MITRE Group</span><span class="value">${safe(actor.mitre_group_id)}</span></div>
      <div class="item"><span class="label">Tier</span><span class="value">${safe(scores?.actor_tier)}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Recent Campaigns (${campaigns.length})</div>
    ${campaignsHtml}
  </div>

  <div class="section">
    <div class="section-title">TTP Coverage by Tactic</div>
    ${ttpsHtml}
  </div>

  <button id="close-viewer">Close Tab</button>
  <div class="close-hint">This tab will close automatically in 5 seconds</div>
</div>
<script src="/scripts/aegis-viewer.js" defer></script>
</body>
</html>`;
}

export const GET = withRoutePolicy('/api/aegis/threat-actors/view', routeGETImplementation);

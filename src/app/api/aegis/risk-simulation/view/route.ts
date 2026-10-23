import { NextResponse } from 'next/server';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/risk-simulation/view
 *
 * Stub viewer for AEGIS Monte Carlo risk simulation citations. Simulations are
 * computed per-invocation, so this viewer is informational only — it confirms
 * that the agent ran a fresh simulation and points back to the chat for the
 * full results. CRT-styled (Matrix green accent). Auto-closes after 5s.
 */
async function routeGETImplementation() {
  return new NextResponse(buildSimulationHtml(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function buildSimulationHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AEGIS Risk Simulation</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e8e8e8;font-family:'Geist Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{border:1px solid rgba(0,255,65,0.3);border-radius:8px;padding:40px 48px;
    max-width:520px;width:100%;box-shadow:0 0 20px rgba(0,255,65,0.08);text-align:center}
  h1{font-size:12px;color:#00ff41;text-transform:uppercase;letter-spacing:2px;margin-bottom:20px}
  .icon{font-size:48px;color:#00ff41;margin-bottom:16px;line-height:1}
  .title{font-size:18px;font-weight:700;margin-bottom:12px;color:#00ff41}
  .body{font-size:12px;color:#bbb;line-height:1.7;margin-bottom:20px}
  .meta{font-size:10px;color:#888;line-height:1.5;text-align:left;background:rgba(0,255,65,0.04);
    border:1px solid rgba(0,255,65,0.12);border-radius:4px;padding:14px 16px;margin-bottom:18px}
  .meta strong{color:#00ff41}
  .close-hint{font-size:10px;color:#555;margin-top:18px}
  button{display:block;margin:0 auto;background:transparent;border:1px solid rgba(0,255,65,0.4);color:#00ff41;
    font-family:inherit;font-size:11px;padding:8px 20px;border-radius:4px;cursor:pointer}
  button:hover{background:rgba(0,255,65,0.1)}
</style>
</head>
<body>
<div class="card">
  <h1>AEGIS Risk Simulation</h1>
  <div class="icon">&sigma;</div>
  <div class="title">Monte Carlo Engine</div>
  <div class="body">
    Risk simulations are computed per-invocation by the AEGIS Monte Carlo engine.
    Results are streamed directly into the Max response and not persisted to a
    canonical URL.
  </div>
  <div class="meta">
    <div><strong>Engine:</strong> Mulberry32 PRNG + Box-Muller + Cholesky correlation</div>
    <div><strong>Default Runs:</strong> 1,000 (max 5,000)</div>
    <div><strong>Outputs:</strong> Loss P5&ndash;P95, 6 stress scenarios, tornado sensitivity</div>
    <div><strong>Runtime:</strong> ~200&ndash;500ms typical</div>
  </div>
  <div style="font-size:11px;color:#888">See the Max response for full distributions and scenario breakdowns.</div>
  <button onclick="window.close()" style="margin-top:18px">Close Tab</button>
  <div class="close-hint">This tab will close automatically in 5 seconds</div>
</div>
<script>setTimeout(function(){window.close()},5000)</script>
</body>
</html>`;
}

export const GET = withRoutePolicy('/api/aegis/risk-simulation/view', routeGETImplementation);

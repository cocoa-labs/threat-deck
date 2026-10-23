import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/actor-matrix
 *
 * Powers the MATRIX hero lens (actors × MITRE ATT&CK tactics heatmap).
 * Returns:
 *   - `actors`  → ranked threat actors (top 12 by composite score, joined
 *                  with display name + actor type for the matrix row labels)
 *   - `tactics` → the 14 MITRE Enterprise ATT&CK tactics, in canonical
 *                  kill-chain order (Reconnaissance → Impact). Hardcoded
 *                  reference data — MITRE has not added a new tactic since
 *                  the v8 release (2020), so this is safe to keep in code.
 *   - `cells`   → one entry per (actor, tactic) the actor is active in, with
 *                  `techniqueCount` driving heatmap intensity and a
 *                  `topTechniques` array (up to 3) for the hover tooltip.
 *
 * The hot path is a single GROUP BY query across aegis_threat_actor_ttps
 * joined to aegis_threat_actor_scores for ranking; everything fits in one
 * round trip and caches for 10 minutes.
 */

interface ActorRow {
  actor_id: string;
  display_name: string;
  actor_type: string | null;
  composite_score: number | null;
  actor_grade: string | null;
}

interface CellRow {
  actor_id: string;
  mitre_tactic_id: string;
  technique_count: number;
  top_techniques: string[];
}

interface Tactic {
  tacticId: string;
  shortName: string;
  name: string;
  url: string;
}

/**
 * The 14 MITRE ATT&CK Enterprise tactics in canonical kill-chain order.
 * Source: https://attack.mitre.org/tactics/enterprise/
 */
const TACTICS: Tactic[] = [
  {
    tacticId: 'TA0043',
    shortName: 'recon',
    name: 'Reconnaissance',
    url: 'https://attack.mitre.org/tactics/TA0043/',
  },
  {
    tacticId: 'TA0042',
    shortName: 'resource-dev',
    name: 'Resource Development',
    url: 'https://attack.mitre.org/tactics/TA0042/',
  },
  {
    tacticId: 'TA0001',
    shortName: 'initial-access',
    name: 'Initial Access',
    url: 'https://attack.mitre.org/tactics/TA0001/',
  },
  {
    tacticId: 'TA0002',
    shortName: 'execution',
    name: 'Execution',
    url: 'https://attack.mitre.org/tactics/TA0002/',
  },
  {
    tacticId: 'TA0003',
    shortName: 'persistence',
    name: 'Persistence',
    url: 'https://attack.mitre.org/tactics/TA0003/',
  },
  {
    tacticId: 'TA0004',
    shortName: 'priv-escalation',
    name: 'Privilege Escalation',
    url: 'https://attack.mitre.org/tactics/TA0004/',
  },
  {
    tacticId: 'TA0005',
    shortName: 'defense-evasion',
    name: 'Defense Evasion',
    url: 'https://attack.mitre.org/tactics/TA0005/',
  },
  {
    tacticId: 'TA0006',
    shortName: 'cred-access',
    name: 'Credential Access',
    url: 'https://attack.mitre.org/tactics/TA0006/',
  },
  {
    tacticId: 'TA0007',
    shortName: 'discovery',
    name: 'Discovery',
    url: 'https://attack.mitre.org/tactics/TA0007/',
  },
  {
    tacticId: 'TA0008',
    shortName: 'lateral-movement',
    name: 'Lateral Movement',
    url: 'https://attack.mitre.org/tactics/TA0008/',
  },
  {
    tacticId: 'TA0009',
    shortName: 'collection',
    name: 'Collection',
    url: 'https://attack.mitre.org/tactics/TA0009/',
  },
  {
    tacticId: 'TA0011',
    shortName: 'cmd-control',
    name: 'Command and Control',
    url: 'https://attack.mitre.org/tactics/TA0011/',
  },
  {
    tacticId: 'TA0010',
    shortName: 'exfiltration',
    name: 'Exfiltration',
    url: 'https://attack.mitre.org/tactics/TA0010/',
  },
  {
    tacticId: 'TA0040',
    shortName: 'impact',
    name: 'Impact',
    url: 'https://attack.mitre.org/tactics/TA0040/',
  },
];

async function routeGETImplementation() {
  try {
    // Top actors by composite score; left-join scores so unscored actors still
    // appear (at the bottom).
    const actorsResult = await query<ActorRow>(
      `SELECT a.actor_id, a.display_name, a.actor_type,
              s.composite_score, s.actor_grade
         FROM aegis_threat_actors a
         LEFT JOIN aegis_threat_actor_scores s ON a.actor_id = s.actor_id
        ORDER BY s.composite_score DESC NULLS LAST, a.display_name
        LIMIT 12`,
    );

    // Cells: one row per (actor, tactic) the actor is active in.
    // Aggregates technique count + first 3 unique technique IDs for the tooltip.
    const cellsResult = await query<CellRow>(
      `SELECT t.actor_id,
              t.mitre_tactic_id,
              COUNT(DISTINCT t.mitre_technique_id)::int AS technique_count,
              (ARRAY_AGG(DISTINCT t.mitre_technique_id ORDER BY t.mitre_technique_id))[1:3] AS top_techniques
         FROM aegis_threat_actor_ttps t
        WHERE t.mitre_tactic_id IS NOT NULL
          AND t.mitre_technique_id IS NOT NULL
        GROUP BY t.actor_id, t.mitre_tactic_id`,
    );

    const actors = actorsResult.rows.map((r) => ({
      actorId: r.actor_id,
      displayName: r.display_name,
      actorType: r.actor_type,
      compositeScore: r.composite_score,
      actorGrade: r.actor_grade,
    }));

    const cells = cellsResult.rows.map((r) => ({
      actorId: r.actor_id,
      tacticId: r.mitre_tactic_id,
      techniqueCount: r.technique_count,
      topTechniques: r.top_techniques ?? [],
    }));

    // Max technique count across all cells — the heatmap intensity normalizer.
    const maxTechniqueCount = cells.reduce((m, c) => Math.max(m, c.techniqueCount), 0);

    const response = NextResponse.json({
      actors,
      tactics: TACTICS,
      cells,
      maxTechniqueCount,
      count: { actors: actors.length, tactics: TACTICS.length, cells: cells.length },
      timestamp: new Date().toISOString(),
    });
    response.headers.set('Cache-Control', 'public, max-age=600, s-maxage=600');
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch actor matrix';
    console.error('[aegis/actor-matrix] Error:', err);
    return NextResponse.json({
      actors: [],
      tactics: TACTICS,
      cells: [],
      maxTechniqueCount: 0,
      count: { actors: 0, tactics: TACTICS.length, cells: 0 },
      timestamp: new Date().toISOString(),
      error: message,
    });
  }
}

export const GET = withRoutePolicy('/api/aegis/actor-matrix', routeGETImplementation);

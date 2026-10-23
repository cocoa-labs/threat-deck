import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/threat-graph
 *
 * Returns a force-directed graph of threat actors, their campaigns, the CVEs
 * they exploited, and their known victims. Powers the Sigma.js threat-actor
 * graph tab in the hero visualization.
 *
 * Response shape:
 *   {
 *     nodes: GraphNode[],
 *     edges: GraphEdge[],
 *     count: { actors, campaigns, cves, victims },
 *     timestamp: string,
 *     error?: string
 *   }
 *
 *   GraphNode = {
 *     id: string,                       // 'actor:APT29' / 'campaign:42' / 'cve:CVE-2024-XXX' / 'victim:7'
 *     kind: 'threat_actor' | 'campaign' | 'cve' | 'victim',
 *     label: string,
 *     data: Record<string, unknown>,
 *   }
 *
 *   GraphEdge = {
 *     id: string,
 *     source: string,
 *     target: string,
 *     kind: 'uses' | 'exploits' | 'targets',
 *   }
 */

interface ActorRow {
  actor_id: string;
  display_name: string;
  actor_type: string | null;
  attribution_country: string | null;
  composite_score: number | null;
  actor_grade: string | null;
}

interface CampaignRow {
  id: number;
  actor_id: string;
  campaign_name: string;
  cve_ids_exploited: string[] | null;
  target_sectors: string[] | null;
}

interface CVERow {
  cve_id: string;
  summary: string | null;
  severity: string | null;
  cvss_v3_score: number | null;
}

interface TargetRow {
  id: number;
  actor_id: string;
  org_name: string | null;
  industry: string | null;
  geography: string | null;
}

interface GraphNode {
  id: string;
  kind: 'threat_actor' | 'campaign' | 'cve' | 'victim';
  label: string;
  data: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'uses' | 'exploits' | 'targets';
}

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'public, max-age=600, s-maxage=600');
  return response;
}

function emptyResponse(error?: string) {
  return NextResponse.json({
    nodes: [],
    edges: [],
    count: { actors: 0, campaigns: 0, cves: 0, victims: 0 },
    timestamp: new Date().toISOString(),
    ...(error ? { error } : {}),
  });
}

async function routeGETImplementation() {
  try {
    // 1) Top 10 threat actors by composite score
    const actorsResult = await query<ActorRow>(
      `SELECT
         a.actor_id,
         a.display_name,
         a.actor_type,
         a.attribution_country,
         s.composite_score,
         s.actor_grade
       FROM aegis_threat_actors a
       LEFT JOIN aegis_threat_actor_scores s ON s.actor_id = a.actor_id
       ORDER BY COALESCE(s.composite_score, 0) DESC
       LIMIT 10`,
    );

    const actors = actorsResult.rows;
    if (actors.length === 0) {
      return withCacheHeaders(emptyResponse());
    }

    const actorIds = actors.map((a) => a.actor_id);

    // 2) Campaigns for those actors
    const campaignsResult = await query<CampaignRow>(
      `SELECT id, actor_id, campaign_name, cve_ids_exploited, target_sectors
       FROM aegis_threat_actor_campaigns
       WHERE actor_id = ANY($1::text[])`,
      [actorIds],
    );

    const campaigns = campaignsResult.rows;

    // 3) Collect unique CVE ids referenced by any campaign
    const cveIdSet = new Set<string>();
    for (const c of campaigns) {
      if (Array.isArray(c.cve_ids_exploited)) {
        for (const id of c.cve_ids_exploited) {
          if (id) cveIdSet.add(id);
        }
      }
    }
    const cveIds = Array.from(cveIdSet);

    let cveById: Map<string, CVERow> = new Map();
    if (cveIds.length > 0) {
      const cvesResult = await query<CVERow>(
        `SELECT cve_id, summary, severity, cvss_v3_score
         FROM aegis_cves
         WHERE cve_id = ANY($1::text[])`,
        [cveIds],
      );
      cveById = new Map(cvesResult.rows.map((r) => [r.cve_id, r]));
    }

    // 4) Targets per actor — used as victim nodes
    const targetsResult = await query<TargetRow>(
      `SELECT id, actor_id, org_name, industry, geography
       FROM aegis_threat_actor_targets
       WHERE actor_id = ANY($1::text[])`,
      [actorIds],
    );

    const targets = targetsResult.rows;

    // Build graph in memory
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const addedCveIds = new Set<string>();

    // Actor nodes
    for (const a of actors) {
      nodes.push({
        id: `actor:${a.actor_id}`,
        kind: 'threat_actor',
        label: a.display_name,
        data: {
          actorId: a.actor_id,
          displayName: a.display_name,
          actorType: a.actor_type,
          attributionCountry: a.attribution_country,
          compositeScore: a.composite_score,
          actorGrade: a.actor_grade,
          sourceUrl: `/api/aegis/threat-actors/view?id=${a.actor_id}`,
        },
      });
    }

    // Campaign nodes + actor→campaign edges + campaign→cve edges
    // Also build a quick lookup: actorId → first campaign id (used to anchor victims)
    const firstCampaignForActor = new Map<string, number>();
    for (const c of campaigns) {
      const campaignNodeId = `campaign:${c.id}`;
      nodes.push({
        id: campaignNodeId,
        kind: 'campaign',
        label: c.campaign_name,
        data: {
          campaignId: c.id,
          actorId: c.actor_id,
          campaignName: c.campaign_name,
          targetSectors: c.target_sectors ?? [],
          cveIdsExploited: c.cve_ids_exploited ?? [],
        },
      });
      edges.push({
        id: `e:actor:${c.actor_id}->${campaignNodeId}`,
        source: `actor:${c.actor_id}`,
        target: campaignNodeId,
        kind: 'uses',
      });

      if (!firstCampaignForActor.has(c.actor_id)) {
        firstCampaignForActor.set(c.actor_id, c.id);
      }

      if (Array.isArray(c.cve_ids_exploited)) {
        for (const cveId of c.cve_ids_exploited) {
          if (!cveId) continue;
          const cveNodeId = `cve:${cveId}`;
          if (!addedCveIds.has(cveId)) {
            addedCveIds.add(cveId);
            const cveData = cveById.get(cveId);
            nodes.push({
              id: cveNodeId,
              kind: 'cve',
              label: cveId,
              data: {
                cveId,
                summary: cveData?.summary ?? null,
                severity: cveData?.severity ?? null,
                cvssV3Score: cveData?.cvss_v3_score ?? null,
                sourceUrl: `/api/aegis/cves/view?id=${cveId}`,
              },
            });
          }
          edges.push({
            id: `e:${campaignNodeId}->${cveNodeId}`,
            source: campaignNodeId,
            target: cveNodeId,
            kind: 'exploits',
          });
        }
      }
    }

    // Victim nodes + campaign→victim edges (heuristic: anchor to first campaign of that actor)
    for (const t of targets) {
      if (!t.org_name) continue;
      const victimNodeId = `victim:${t.id}`;
      nodes.push({
        id: victimNodeId,
        kind: 'victim',
        label: t.org_name,
        data: {
          targetId: t.id,
          actorId: t.actor_id,
          orgName: t.org_name,
          industry: t.industry,
          geography: t.geography,
        },
      });
      const anchorCampaignId = firstCampaignForActor.get(t.actor_id);
      if (anchorCampaignId !== undefined) {
        edges.push({
          id: `e:campaign:${anchorCampaignId}->${victimNodeId}`,
          source: `campaign:${anchorCampaignId}`,
          target: victimNodeId,
          kind: 'targets',
        });
      } else {
        // Fallback: attach victim directly to actor when actor has no campaigns
        edges.push({
          id: `e:actor:${t.actor_id}->${victimNodeId}`,
          source: `actor:${t.actor_id}`,
          target: victimNodeId,
          kind: 'targets',
        });
      }
    }

    return withCacheHeaders(
      NextResponse.json({
        nodes,
        edges,
        count: {
          actors: actors.length,
          campaigns: campaigns.length,
          cves: addedCveIds.size,
          victims: targets.filter((t) => t.org_name).length,
        },
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    // Fail-soft per rule #9
    const message = err instanceof Error ? err.message : 'Failed to fetch threat graph';
    console.error('[aegis/threat-graph] Error:', err);
    return emptyResponse(message);
  }
}

export const GET = withRoutePolicy('/api/aegis/threat-graph', routeGETImplementation);

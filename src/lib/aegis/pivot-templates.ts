/**
 * Phase 10.2 — Pivot template engine.
 *
 * The IntelCard is read-only — it shows a single entity (threat actor, CVE,
 * victim, campaign). Phase 10 turns it into a co-investigator surface:
 * deterministic "next pivots" suggestions render between the body and the
 * action footer, and clicking one opens the AgentDrawer pre-filled with a
 * concrete investigative prompt.
 *
 * This module owns the deterministic tier — sub-500ms p95, no LLM call,
 * always returns 3 suggestions per kind (or fewer if the entity row is
 * missing the context fields a template depends on). The Haiku augmentation
 * tier lives in pivot-haiku.ts and only fires for high-relevance entities.
 *
 * Templates are written per rule #26 (concise verbs, no "deep analysis"
 * language). The three-mode agent posture decides what depth to render —
 * the pivot prompt's job is to give a sharp instruction, not to dictate
 * format.
 */

import { query, queryOne } from '@/lib/db/client';

// ─── Public surface ──────────────────────────────────────────────────────────

export type PivotKind = 'threat_actor' | 'cve' | 'victim' | 'campaign';

export interface PivotSuggestion {
  /** Short label rendered on the chip (≤60 chars, concise verb phrase). */
  label: string;
  /** The text that pre-fills the AgentDrawer when the chip is clicked. */
  prefillPrompt: string;
  /** Bookkeeping — which entity fields this prompt assumed are present. */
  contextNeeded: string[];
  /** 0-indexed rank within the returned suggestion list (lower = more prominent). */
  rank: number;
  /** Whether this suggestion came from a deterministic template or Haiku. */
  source: 'template' | 'haiku';
}

export type PivotEntityRow =
  | { kind: 'threat_actor'; data: ThreatActorRow }
  | { kind: 'cve'; data: CveRow }
  | { kind: 'victim'; data: VictimRow }
  | { kind: 'campaign'; data: CampaignRow };

// Row shapes — only the fields the templates actually read. Wider SELECTs
// are fine; ignored fields just don't break the templates. Match pg's
// driver casting: numerics → number, timestamptz → string, arrays → T[].

export interface ThreatActorRow {
  actor_id: string;
  display_name: string;
  aliases: string[] | null;
  attribution_country: string | null;
  last_active_at: string | null;
  composite_score: number | null;
  actor_grade: string | null;
  /** Primary targeted sector — derived from aegis_threat_actor_targets. */
  top_sector: string | null;
  /** Closest peer actor by composite_score (for the "compare TTPs" template). */
  peer_actor_display_name: string | null;
  campaign_count: number | null;
  target_count: number | null;
}

export interface CveRow {
  cve_id: string;
  cvss_v3_score: number | null;
  severity: string | null;
  is_kev: boolean | null;
  epss_score: number | null;
  exploited_in_wild: boolean | null;
  primary_vendor: string | null;
  primary_product: string | null;
}

export interface VictimRow {
  id: number;
  org_name: string;
  industry: string | null;
  country: string | null;
  has_active_ransom: boolean | null;
  last_breach_at: string | null;
}

export interface CampaignRow {
  id: number;
  campaign_name: string;
  actor_id: string;
  actor_display_name: string;
  start_date: string | null;
  end_date: string | null;
  /** First targeted sector — for the "victims by industry" template. */
  primary_target_sector: string | null;
}

// ─── loadEntityRow ───────────────────────────────────────────────────────────

/**
 * Look up the row backing a pivot request. Returns `null` if the entity
 * doesn't exist OR the DB call fails — callers MUST fail-soft so the
 * IntelCard can render without pivots rather than crash.
 *
 * Each kind hits a different shape:
 *   - threat_actor → aegis_v_actor_rankings + derived top sector + peer
 *   - cve          → aegis_v_cve_summary + primary vendor/product
 *   - victim       → aegis_compromised_orgs
 *   - campaign     → aegis_threat_actor_campaigns JOIN actors
 */
export async function loadEntityRow(
  kind: PivotKind,
  entityId: string,
): Promise<PivotEntityRow | null> {
  try {
    switch (kind) {
      case 'threat_actor': {
        const row = await queryOne<ThreatActorRow>(
          // Note: the targets table uses `industry` (not `sector`) and has no
          // `confidence` column — order by recency only. `created_at` is a
          // formatted text timestamp; ORDER BY text still sorts correctly
          // because of the YYYY-MM-DD HH24:MI:SS format.
          `SELECT
             a.actor_id,
             a.display_name,
             a.aliases,
             a.attribution_country,
             a.last_active_at,
             s.composite_score,
             s.actor_grade,
             (SELECT industry
                FROM aegis_threat_actor_targets t
                WHERE t.actor_id = a.actor_id
                  AND industry IS NOT NULL
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1) AS top_sector,
             (SELECT a2.display_name
                FROM aegis_threat_actor_scores s2
                JOIN aegis_threat_actors a2 ON a2.actor_id = s2.actor_id
                WHERE s2.actor_id <> a.actor_id
                  AND s.composite_score IS NOT NULL
                ORDER BY ABS(COALESCE(s2.composite_score, 0) - COALESCE(s.composite_score, 0)) ASC
                LIMIT 1) AS peer_actor_display_name,
             (SELECT COUNT(*)::int
                FROM aegis_threat_actor_campaigns c
                WHERE c.actor_id = a.actor_id) AS campaign_count,
             (SELECT COUNT(*)::int
                FROM aegis_threat_actor_targets t
                WHERE t.actor_id = a.actor_id) AS target_count
           FROM aegis_threat_actors a
           LEFT JOIN aegis_threat_actor_scores s ON s.actor_id = a.actor_id
           WHERE a.actor_id = $1
              OR $1 = ANY(a.aliases)
              OR LOWER(a.display_name) = LOWER($1)
           LIMIT 1`,
          [entityId],
        );
        return row ? { kind: 'threat_actor', data: row } : null;
      }
      case 'cve': {
        const row = await queryOne<CveRow>(
          // Note: aegis_affected_products has no `product_popularity` column.
          // Use the lowest-id row as a stable, deterministic primary (effectively
          // "first ingested"). For a multi-vendor CVE this is a heuristic; good
          // enough for pivot template inputs.
          `SELECT
             c.cve_id,
             c.cvss_v3_score,
             c.severity,
             c.is_kev,
             c.epss_score,
             c.exploited_in_wild,
             (SELECT vendor
                FROM aegis_affected_products p
                WHERE p.cve_id = c.cve_id AND vendor IS NOT NULL
                ORDER BY p.id ASC
                LIMIT 1) AS primary_vendor,
             (SELECT product
                FROM aegis_affected_products p
                WHERE p.cve_id = c.cve_id AND product IS NOT NULL
                ORDER BY p.id ASC
                LIMIT 1) AS primary_product
           FROM aegis_cves c
           WHERE c.cve_id = $1
           LIMIT 1`,
          [entityId],
        );
        return row ? { kind: 'cve', data: row } : null;
      }
      case 'victim': {
        // Entity IDs may arrive as either the bigint id or the org_name slug.
        const isNumeric = /^\d+$/.test(entityId);
        const row = await queryOne<VictimRow>(
          isNumeric
            ? `SELECT id, org_name, industry, country, has_active_ransom, last_breach_at
                 FROM aegis_compromised_orgs WHERE id = $1 LIMIT 1`
            : `SELECT id, org_name, industry, country, has_active_ransom, last_breach_at
                 FROM aegis_compromised_orgs WHERE LOWER(org_name) = LOWER($1) LIMIT 1`,
          [entityId],
        );
        return row ? { kind: 'victim', data: row } : null;
      }
      case 'campaign': {
        const isNumeric = /^\d+$/.test(entityId);
        const row = await queryOne<CampaignRow>(
          `SELECT
             c.id,
             c.campaign_name,
             c.actor_id,
             a.display_name AS actor_display_name,
             c.start_date,
             c.end_date,
             (c.target_sectors)[1] AS primary_target_sector
           FROM aegis_threat_actor_campaigns c
           JOIN aegis_threat_actors a ON a.actor_id = c.actor_id
           WHERE ${isNumeric ? 'c.id = $1' : 'LOWER(c.campaign_name) = LOWER($1)'}
           LIMIT 1`,
          [entityId],
        );
        return row ? { kind: 'campaign', data: row } : null;
      }
    }
  } catch {
    // Fail-soft — IntelCard renders without pivots rather than 500ing.
    return null;
  }
}

// ─── buildTemplatedPivots ────────────────────────────────────────────────────

/**
 * Build up to 3 deterministic pivot suggestions for an entity. Templates
 * that depend on context fields the row doesn't have are dropped silently;
 * the result is always 0–3 suggestions.
 *
 * Ranks are assigned by output position (0, 1, 2). The Haiku tier (when it
 * fires) appends its single suggestion at rank 3 and the route trims the
 * lowest-ranked template to keep the displayed total at 3.
 */
export function buildTemplatedPivots(entity: PivotEntityRow): PivotSuggestion[] {
  switch (entity.kind) {
    case 'threat_actor':
      return buildThreatActorPivots(entity.data);
    case 'cve':
      return buildCvePivots(entity.data);
    case 'victim':
      return buildVictimPivots(entity.data);
    case 'campaign':
      return buildCampaignPivots(entity.data);
  }
}

// ─── Per-kind template builders ──────────────────────────────────────────────

function buildThreatActorPivots(row: ThreatActorRow): PivotSuggestion[] {
  const out: PivotSuggestion[] = [];

  if (row.top_sector) {
    out.push({
      label: `Find ${row.display_name} victims in ${row.top_sector} (30d)`,
      prefillPrompt: `Find ${row.display_name} victims in ${row.top_sector} sector over the last 30 days. List org names, country, and any active ransom status.`,
      contextNeeded: ['display_name', 'top_sector'],
      rank: 0,
      source: 'template',
    });
  }

  if (row.peer_actor_display_name) {
    out.push({
      label: `Compare ${row.display_name} TTPs vs ${row.peer_actor_display_name}`,
      prefillPrompt: `Compare ${row.display_name} TTPs against ${row.peer_actor_display_name}. Map both to MITRE ATT&CK techniques and highlight overlaps + divergences.`,
      contextNeeded: ['display_name', 'peer_actor_display_name'],
      rank: out.length,
      source: 'template',
    });
  }

  out.push({
    label: `Show CVEs ${row.display_name} exploited but unpatched`,
    prefillPrompt: `Show CVEs exploited by ${row.display_name} that are NOT yet patched in our environment. Include CVSS, KEV status, and EPSS percentile.`,
    contextNeeded: ['display_name'],
    rank: out.length,
    source: 'template',
  });

  return out.slice(0, 3);
}

function buildCvePivots(row: CveRow): PivotSuggestion[] {
  const out: PivotSuggestion[] = [];

  out.push({
    label: `Which orgs are exposed to ${row.cve_id}?`,
    prefillPrompt: `Which organizations are exposed to ${row.cve_id}? List affected sectors and any active ransomware campaigns leveraging this CVE.`,
    contextNeeded: ['cve_id'],
    rank: 0,
    source: 'template',
  });

  out.push({
    label: `Defenses that mitigate ${row.cve_id}`,
    prefillPrompt: `Match defenses that mitigate ${row.cve_id}. Include MITRE D3FEND techniques, framework controls, and the lowest-cost-tier remediations available.`,
    contextNeeded: ['cve_id'],
    rank: 1,
    source: 'template',
  });

  if (row.primary_vendor && row.primary_product) {
    out.push({
      label: `Historical comps for ${row.primary_vendor} ${row.primary_product}`,
      prefillPrompt: `Find historical incident comps for ${row.primary_vendor} ${row.primary_product} CVEs in the past 24 months. Average time-to-KEV, average time-to-patch, and notable exploitation campaigns.`,
      contextNeeded: ['primary_vendor', 'primary_product'],
      rank: 2,
      source: 'template',
    });
  } else {
    out.push({
      label: `Historical comps for ${row.cve_id}`,
      prefillPrompt: `Find historical incident comps for CVEs similar to ${row.cve_id} in the past 24 months. Average time-to-KEV and average time-to-patch.`,
      contextNeeded: ['cve_id'],
      rank: 2,
      source: 'template',
    });
  }

  return out.slice(0, 3);
}

function buildVictimPivots(row: VictimRow): PivotSuggestion[] {
  const out: PivotSuggestion[] = [];

  out.push({
    label: `Who attacked ${row.org_name}?`,
    prefillPrompt: `Who has attacked ${row.org_name}? List threat actors with attribution confidence and any active campaigns.`,
    contextNeeded: ['org_name'],
    rank: 0,
    source: 'template',
  });

  if (row.industry) {
    out.push({
      label: `Comparable breaches in ${row.industry}`,
      prefillPrompt: `Find comparable breach disclosures in ${row.industry} over the last 12 months. Compare records compromised, attack vector, and threat actor where attributed.`,
      contextNeeded: ['industry'],
      rank: out.length,
      source: 'template',
    });
  }

  out.push({
    label: `Defenses against this attack vector`,
    prefillPrompt: `Match defenses for the attack vector used against ${row.org_name}. Include MITRE D3FEND techniques and framework controls.`,
    contextNeeded: ['org_name'],
    rank: out.length,
    source: 'template',
  });

  return out.slice(0, 3);
}

function buildCampaignPivots(row: CampaignRow): PivotSuggestion[] {
  const out: PivotSuggestion[] = [];

  out.push({
    label: `What CVEs did ${row.campaign_name} exploit?`,
    prefillPrompt: `List the CVEs exploited in the ${row.campaign_name} campaign by ${row.actor_display_name}. Include CVSS, KEV status, and patch availability at time of campaign.`,
    contextNeeded: ['campaign_name', 'actor_display_name'],
    rank: 0,
    source: 'template',
  });

  if (row.primary_target_sector) {
    out.push({
      label: `Victims of ${row.campaign_name} in ${row.primary_target_sector}`,
      prefillPrompt: `Find victims of ${row.campaign_name} in the ${row.primary_target_sector} sector. List org names, country, and disclosed records compromised.`,
      contextNeeded: ['campaign_name', 'primary_target_sector'],
      rank: out.length,
      source: 'template',
    });
  } else {
    out.push({
      label: `Victims of ${row.campaign_name}`,
      prefillPrompt: `Find all known victims of ${row.campaign_name}. Group by industry and country, and list disclosed records compromised.`,
      contextNeeded: ['campaign_name'],
      rank: out.length,
      source: 'template',
    });
  }

  out.push({
    label: `Predicted next sector ${row.actor_display_name} targets`,
    prefillPrompt: `Given the ${row.campaign_name} campaign trajectory, predict the next sector ${row.actor_display_name} is most likely to target. Reason from historical TTPs and target patterns.`,
    contextNeeded: ['campaign_name', 'actor_display_name'],
    rank: out.length,
    source: 'template',
  });

  return out.slice(0, 3);
}

// ─── Source-URL builder ──────────────────────────────────────────────────────

/**
 * Resolve a citation URL for the entity per rule #21 — every IntelCard
 * surface must surface a clickable source link. Routes to the existing
 * AEGIS HTML viewer pattern: /api/aegis/{kind}/view?id=...
 */
export function buildEntitySourceUrl(kind: PivotKind, entityId: string): string {
  const slug =
    kind === 'threat_actor'
      ? 'threat-actors'
      : kind === 'cve'
        ? 'cves'
        : kind === 'victim'
          ? 'compromised-orgs'
          : 'incidents'; // campaign — closest existing viewer
  return `/api/aegis/${slug}/view?id=${encodeURIComponent(entityId)}`;
}

// ─── Diagnostic: which kinds should the API accept? ──────────────────────────

export const SUPPORTED_PIVOT_KINDS: readonly PivotKind[] = [
  'threat_actor',
  'cve',
  'victim',
  'campaign',
];

export function isPivotKind(value: unknown): value is PivotKind {
  return typeof value === 'string' && (SUPPORTED_PIVOT_KINDS as readonly string[]).includes(value);
}

// Re-export the query for tests that want to seed rows.
export { query };

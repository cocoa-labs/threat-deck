/**
 * Phase 9.4 — SQL data assemblers for the four Twitter content generators.
 *
 * Each function returns a deterministic, JSON-stringifiable payload that
 * the corresponding generator feeds into Anthropic as the user message.
 * No tool-use loop; the agent doesn't decide what to query. SQL is the
 * source of truth.
 *
 * Reads from `aegis_pipeline_alerts` (joined to AEGIS subsystems as needed).
 * `ai_relevance` is read directly off the alert row per the Phase 9.0 ALTER.
 */

import { deriveSourceUrl } from '@/lib/aegis/source-url';
import { query } from '@/lib/db/client';
import { severityWeight } from './format';

// ─── Daily brief / breaking ──────────────────────────────────────────────────

export interface DailyBriefStory {
  /** CVE identifier when the source alert is CVE-typed; otherwise null. */
  cveId: string | null;
  headline: string;
  summary: string;
  sourceUrl: string;
  severity: string;
  aiRelevance: number;
  sourceAlertId: number;
}

/**
 * Top N AI-cyber stories from the last `sinceHours` window, sorted by
 * `aiRelevance × severityWeight(severity)`. Filters to `(ai_relevance >= 0.5
 * OR severity = 'critical')` so the threshold matches the Phase 9.6 Cyber
 * Wire narrowing.
 */
export async function fetchDailyBriefTopStories(opts: {
  sinceHours: number;
  maxStories: number;
}): Promise<DailyBriefStory[]> {
  const { rows } = await query<{
    id: number;
    entity_kind: string;
    entity_id: string;
    severity: string;
    headline: string | null;
    summary: string | null;
    ai_relevance: string | null;
  }>(
    `SELECT id, entity_kind, entity_id, severity, headline, summary, ai_relevance
       FROM aegis_pipeline_alerts
      WHERE (ai_relevance >= 0.5 OR severity = 'critical')
        AND published_at::timestamptz >= NOW() - ($1 || ' hours')::interval
      ORDER BY published_at DESC
      LIMIT 100`,
    [String(opts.sinceHours)],
  );

  const enriched = rows.map((r) => {
    const rel = r.ai_relevance == null ? 0 : Number(r.ai_relevance);
    return {
      cveId: r.entity_kind === 'cve' ? r.entity_id : null,
      headline: r.headline ?? r.entity_id,
      summary: r.summary ?? '',
      sourceUrl: deriveSourceUrl(r.entity_kind, r.entity_id),
      severity: r.severity,
      aiRelevance: rel,
      sourceAlertId: r.id,
      _score: rel * severityWeight(r.severity),
    };
  });

  enriched.sort((a, b) => b._score - a._score);

  return enriched.slice(0, opts.maxStories).map(({ _score: _, ...story }) => story);
}

/** Pull the single alert that triggered a breaking tweet. */
export async function fetchBreakingContext(opts: {
  sourceAlertId: number;
}): Promise<DailyBriefStory | null> {
  const { rows } = await query<{
    id: number;
    entity_kind: string;
    entity_id: string;
    severity: string;
    headline: string | null;
    summary: string | null;
    ai_relevance: string | null;
  }>(
    `SELECT id, entity_kind, entity_id, severity, headline, summary, ai_relevance
       FROM aegis_pipeline_alerts
      WHERE id = $1`,
    [opts.sourceAlertId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    cveId: r.entity_kind === 'cve' ? r.entity_id : null,
    headline: r.headline ?? r.entity_id,
    summary: r.summary ?? '',
    sourceUrl: deriveSourceUrl(r.entity_kind, r.entity_id),
    severity: r.severity,
    aiRelevance: r.ai_relevance == null ? 0 : Number(r.ai_relevance),
    sourceAlertId: r.id,
  };
}

// ─── Weekly deep-dive (analyst mode) ─────────────────────────────────────────

export interface ApexWeeklyContext {
  story: DailyBriefStory;
  /** MITRE technique IDs observed for any threat actor tied to this story. */
  ttps: string[];
  /** IOC values related to the apex CVE / actor. Capped to 10. */
  iocs: string[];
  /** Names of recent campaigns mentioning the apex CVE / actor. */
  campaigns: string[];
}

/**
 * Picks the single highest-scored AI-cyber story over the last `sinceDays`
 * window and enriches it with MITRE TTPs, IOCs, and campaign references
 * via the AEGIS join graph. Returns null when there isn't a qualifying
 * apex story (rare — confirms the week was quiet).
 */
export async function fetchApexWeeklyStory(opts: {
  sinceDays: number;
}): Promise<ApexWeeklyContext | null> {
  const stories = await fetchDailyBriefTopStories({
    sinceHours: opts.sinceDays * 24,
    maxStories: 1,
  });
  const apex = stories[0];
  if (!apex) return null;

  const ttps: string[] = [];
  const iocs: string[] = [];
  const campaigns: string[] = [];

  if (apex.cveId) {
    // IOCs related to this CVE
    const iocRows = await query<{ value: string; ioc_type: string }>(
      `SELECT value, ioc_type FROM aegis_iocs WHERE related_cve_id = $1 ORDER BY first_seen DESC LIMIT 10`,
      [apex.cveId],
    );
    for (const r of iocRows.rows) {
      iocs.push(`${r.ioc_type}:${r.value}`);
    }

    // TTPs from actors that historically exploited this CVE (via campaigns)
    const ttpRows = await query<{ mitre_technique_id: string }>(
      `SELECT DISTINCT t.mitre_technique_id
         FROM aegis_threat_actor_ttps t
         JOIN aegis_threat_actor_campaigns c ON c.actor_id = t.actor_id
        WHERE $1 = ANY(c.cve_ids_exploited)
          AND t.mitre_technique_id IS NOT NULL
        LIMIT 15`,
      [apex.cveId],
    );
    for (const r of ttpRows.rows) ttps.push(r.mitre_technique_id);

    // Campaign names referencing this CVE
    const campaignRows = await query<{ campaign_name: string }>(
      `SELECT campaign_name FROM aegis_threat_actor_campaigns
        WHERE $1 = ANY(cve_ids_exploited) ORDER BY start_date DESC NULLS LAST LIMIT 5`,
      [apex.cveId],
    );
    for (const r of campaignRows.rows) campaigns.push(r.campaign_name);
  }

  return { story: apex, ttps, iocs, campaigns };
}

// ─── Patch thread (fix-architect mode) ───────────────────────────────────────

export interface PatchContext {
  story: DailyBriefStory;
  /** Affected vendor/product strings — capped to 8 for tweet-thread brevity. */
  affectedProducts: string[];
  /** Vendor remediations: patch version + release date + advisory URL. */
  remediations: { vendor: string; patchVersion: string; releasedAt: string; advisoryUrl: string }[];
}

/**
 * Assemble the per-CVE remediation context. Looks up the alert by CVE id,
 * then joins affected products + remediations. Returns null if the CVE
 * isn't in `aegis_cves` (defensive — should never happen for KEV adds).
 */
export async function fetchPatchContext(opts: { cveId: string }): Promise<PatchContext | null> {
  // First try to find an existing pipeline alert for this CVE — gives us
  // headline + summary already authored by the ingester.
  const alertRows = await query<{
    id: number;
    severity: string;
    headline: string | null;
    summary: string | null;
    ai_relevance: string | null;
  }>(
    `SELECT id, severity, headline, summary, ai_relevance
       FROM aegis_pipeline_alerts
      WHERE entity_kind = 'cve' AND entity_id = $1
      ORDER BY id DESC LIMIT 1`,
    [opts.cveId],
  );

  // Fall back to aegis_cves for headline if no alert exists.
  let story: DailyBriefStory | null = null;
  if (alertRows.rows[0]) {
    const a = alertRows.rows[0];
    story = {
      cveId: opts.cveId,
      headline: a.headline ?? opts.cveId,
      summary: a.summary ?? '',
      sourceUrl: deriveSourceUrl('cve', opts.cveId),
      severity: a.severity,
      aiRelevance: a.ai_relevance == null ? 0 : Number(a.ai_relevance),
      sourceAlertId: a.id,
    };
  } else {
    const cveRows = await query<{ summary: string | null; severity: string | null }>(
      `SELECT summary, severity FROM aegis_cves WHERE cve_id = $1`,
      [opts.cveId],
    );
    if (!cveRows.rows[0]) return null;
    story = {
      cveId: opts.cveId,
      headline: opts.cveId,
      summary: cveRows.rows[0].summary ?? '',
      sourceUrl: deriveSourceUrl('cve', opts.cveId),
      severity: cveRows.rows[0].severity ?? 'medium',
      aiRelevance: 0,
      sourceAlertId: 0,
    };
  }

  // Affected products
  const productRows = await query<{ vendor: string | null; product: string | null }>(
    `SELECT DISTINCT vendor, product FROM aegis_affected_products
      WHERE cve_id = $1
      LIMIT 8`,
    [opts.cveId],
  );
  const affectedProducts = productRows.rows
    .map((r) => [r.vendor, r.product].filter(Boolean).join(' '))
    .filter((s) => s.length > 0);

  // Remediations
  const remRows = await query<{
    vendor: string | null;
    patch_version: string | null;
    released_at: string | null;
    advisory_url: string | null;
  }>(
    `SELECT vendor, patch_version, released_at, advisory_url
       FROM aegis_remediations
      WHERE cve_id = $1
      ORDER BY released_at DESC NULLS LAST
      LIMIT 8`,
    [opts.cveId],
  );
  const remediations = remRows.rows.map((r) => ({
    vendor: r.vendor ?? 'unknown vendor',
    patchVersion: r.patch_version ?? 'see advisory',
    releasedAt: r.released_at ?? '',
    advisoryUrl: r.advisory_url ?? '',
  }));

  return { story, affectedProducts, remediations };
}

// `deriveSourceUrl` moved to `src/lib/aegis/source-url.ts` — the alert spine
// needs the same entity→viewer mapping, so it has one definition now.

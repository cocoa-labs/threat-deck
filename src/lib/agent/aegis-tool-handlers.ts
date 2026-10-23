/**
 * AEGIS Intelligence Tool Handlers (cybersecurity deep-intel layer).
 *
 * 7 tool handlers backed by the aegis_* PostgreSQL schema (26 tables, 5 views).
 * Each handler queries the DB via the shared client and returns structured
 * results plus a `sourceUrl` for citation linking.
 */

import {
  aggregateObservations,
  forecastFromObservations,
} from '@/lib/aegis/forecasting/actor-target-bayesian';
import {
  buildInitialModel as buildCausalModel,
  doIntervene,
  VARIABLES,
  type Variable,
} from '@/lib/aegis/forecasting/causal-dag';
import {
  EMISSIONS,
  type Emission,
  inferCveState,
  loadDefaultModel as loadHmmModel,
} from '@/lib/aegis/forecasting/cve-lifecycle-hmm';
import {
  type ExploitFeatures,
  forecastExploit,
  loadDefaultModel as loadLogisticModel,
} from '@/lib/aegis/forecasting/exploit-logistic';
import {
  type DailyValue,
  forecastMetric,
  METRICS,
  type Metric,
} from '@/lib/aegis/forecasting/timeseries-kalman';
import { query } from '@/lib/db/client';

// ─── aegis_search_cves ────────────────────────────────────────────────────────
// Search/filter the CVE pipeline by severity, KEV, exploitation, EPSS, etc.

export async function aegisSearchCves(input: Record<string, unknown>): Promise<unknown> {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (input.search) {
      conditions.push(`LOWER(c.summary) LIKE LOWER($${paramIdx++})`);
      params.push(`%${input.search as string}%`);
    }
    if (input.severity) {
      conditions.push(`c.severity = $${paramIdx++}`);
      params.push(input.severity as string);
    }
    if (input.is_kev != null) {
      conditions.push(`c.is_kev = $${paramIdx++}`);
      params.push(input.is_kev as boolean);
    }
    if (input.exploited_in_wild != null) {
      conditions.push(`c.exploited_in_wild = $${paramIdx++}`);
      params.push(input.exploited_in_wild as boolean);
    }
    if (input.min_cvss != null) {
      conditions.push(`c.cvss_v3_score >= $${paramIdx++}`);
      params.push(input.min_cvss as number);
    }
    if (input.min_epss_percentile != null) {
      conditions.push(`c.epss_percentile >= $${paramIdx++}`);
      params.push((input.min_epss_percentile as number) / 100);
    }
    if (input.vendor) {
      conditions.push(
        `EXISTS (SELECT 1 FROM aegis_affected_products p WHERE p.cve_id = c.cve_id AND LOWER(p.vendor) LIKE LOWER($${paramIdx++}))`,
      );
      params.push(`%${input.vendor as string}%`);
    }
    if (input.product) {
      conditions.push(
        `EXISTS (SELECT 1 FROM aegis_affected_products p WHERE p.cve_id = c.cve_id AND LOWER(p.product) LIKE LOWER($${paramIdx++}))`,
      );
      params.push(`%${input.product as string}%`);
    }
    if (input.published_since) {
      conditions.push(`c.published_at >= $${paramIdx++}`);
      params.push(input.published_since as string);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min((input.limit as number) ?? 25, 50);

    const sql = `
      SELECT
        c.cve_id, c.published_at, c.severity,
        c.cvss_v3_score, c.epss_score, c.epss_percentile,
        c.is_kev, c.kev_added_date,
        c.exploited_in_wild, c.poc_public,
        c.summary, c.nvd_source_url, c.tags,
        c.kev_due_date, c.kev_required_action, c.known_ransomware_use,
        c.remediation_count, c.first_patch_at, c.affected_product_count
      FROM aegis_v_cve_summary c
      ${whereClause}
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    const result = await query<Record<string, unknown>>(sql, params);

    // Severity breakdown
    const severityBreakdown: Record<string, number> = {};
    for (const r of result.rows) {
      const sev = (r.severity as string) ?? 'unknown';
      severityBreakdown[sev] = (severityBreakdown[sev] ?? 0) + 1;
    }

    // Counts
    const kevCount = result.rows.filter((r) => r.is_kev === true).length;
    const exploitedCount = result.rows.filter((r) => r.exploited_in_wild === true).length;

    const topCve = result.rows[0];

    return {
      sourceUrl: topCve ? `/api/aegis/cves/view?id=${topCve.cve_id}` : '/api/aegis/cves/view',
      cves: result.rows.map((r) => ({
        cveId: r.cve_id,
        publishedAt: r.published_at,
        severity: r.severity,
        cvssV3Score: r.cvss_v3_score,
        epssScore: r.epss_score,
        epssPercentile: r.epss_percentile,
        isKev: r.is_kev,
        kevAddedDate: r.kev_added_date,
        kevDueDate: r.kev_due_date,
        kevRequiredAction: r.kev_required_action,
        knownRansomwareUse: r.known_ransomware_use,
        exploitedInWild: r.exploited_in_wild,
        pocPublic: r.poc_public,
        summary: r.summary,
        nvdSourceUrl: r.nvd_source_url,
        tags: r.tags,
        remediationCount: r.remediation_count,
        firstPatchAt: r.first_patch_at,
        affectedProductCount: r.affected_product_count,
        sourceUrl: `/api/aegis/cves/view?id=${r.cve_id}`,
      })),
      matchedCount: result.rows.length,
      severityBreakdown,
      kevCount,
      exploitedCount,
    };
  } catch (err) {
    return {
      error: `AEGIS CVE search failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── aegis_cve_detail ─────────────────────────────────────────────────────────
// Full CVE package: cve + affected products + remediations + IOCs + KEV.

export async function aegisCveDetail(input: Record<string, unknown>): Promise<unknown> {
  const cveId = input.cve_id as string;

  if (!cveId) {
    return { error: 'aegis_cve_detail: cve_id is required' };
  }

  try {
    // Master CVE record
    const cveResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_cves WHERE cve_id = $1`,
      [cveId],
    );
    if (cveResult.rows.length === 0) {
      return { error: `No CVE found with id ${cveId}` };
    }
    const cve = cveResult.rows[0]!;

    // Affected products
    const productsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_affected_products WHERE cve_id = $1 ORDER BY vendor, product`,
      [cveId],
    );

    // Remediations (patches, vendor advisories)
    const remediationsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_remediations WHERE cve_id = $1 ORDER BY released_at DESC NULLS LAST`,
      [cveId],
    );

    // IOCs
    const iocsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_iocs WHERE related_cve_id = $1 ORDER BY first_seen DESC NULLS LAST LIMIT 50`,
      [cveId],
    );

    // KEV metadata
    const kevResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_kev WHERE cve_id = $1`,
      [cveId],
    );
    const kev = kevResult.rows[0] ?? null;

    // Severity history (CVSS/EPSS over time)
    const historyResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_cve_severity_history WHERE cve_id = $1 ORDER BY observed_at ASC`,
      [cveId],
    );

    return {
      sourceUrl: `/api/aegis/cves/view?id=${cve.cve_id}`,
      cve: {
        cveId: cve.cve_id,
        publishedAt: cve.published_at,
        lastModifiedAt: cve.last_modified_at,
        summary: cve.summary,
        cweId: cve.cwe_id,
        cvssV3Score: cve.cvss_v3_score,
        cvssV3Vector: cve.cvss_v3_vector,
        cvssV4Score: cve.cvss_v4_score,
        cvssV4Vector: cve.cvss_v4_vector,
        epssScore: cve.epss_score,
        epssPercentile: cve.epss_percentile,
        severity: cve.severity,
        isKev: cve.is_kev,
        kevAddedDate: cve.kev_added_date,
        exploitedInWild: cve.exploited_in_wild,
        pocPublic: cve.poc_public,
        nvdSourceUrl: cve.nvd_source_url,
        tags: cve.tags,
      },
      affectedProducts: productsResult.rows.map((p) => ({
        vendor: p.vendor,
        product: p.product,
        cpeUri: p.cpe_uri,
        versionRangeStart: p.version_range_start,
        versionRangeEnd: p.version_range_end,
        packageEcosystem: p.package_ecosystem,
        packageName: p.package_name,
        isWorkaroundAvailable: p.is_workaround_available,
      })),
      remediations: remediationsResult.rows.map((r) => ({
        vendor: r.vendor,
        advisoryId: r.advisory_id,
        advisoryUrl: r.advisory_url,
        patchVersion: r.patch_version,
        releasedAt: r.released_at,
        severityRatingVendor: r.severity_rating_vendor,
        mitreMitigationId: r.mitre_mitigation_id,
        notes: r.notes,
      })),
      iocs: iocsResult.rows.map((i) => ({
        iocType: i.ioc_type,
        value: i.value,
        firstSeen: i.first_seen,
        lastSeen: i.last_seen,
        source: i.source,
        confidence: i.confidence,
        tags: i.tags,
      })),
      kev: kev
        ? {
            addedToKevAt: kev.added_to_kev_at,
            dueDate: kev.due_date,
            requiredAction: kev.required_action,
            vulnerabilityName: kev.vulnerability_name,
            vendorProject: kev.vendor_project,
            product: kev.product,
            shortDescription: kev.short_description,
            knownRansomwareUse: kev.known_ransomware_use,
            notes: kev.notes,
          }
        : null,
      severityHistory: historyResult.rows.map((h) => ({
        observedAt: h.observed_at,
        cvssScore: h.cvss_score,
        epssScore: h.epss_score,
        epssPercentile: h.epss_percentile,
        eventType: h.event_type,
        source: h.source,
      })),
      summary: {
        affectedProductCount: productsResult.rows.length,
        remediationCount: remediationsResult.rows.length,
        iocCount: iocsResult.rows.length,
        hasKev: kev !== null,
      },
      // Client-side marker: fly the globe to a matching geo event if loaded.
      // Pure side-effect signal (Rule #5) — no-op when no marker exists.
      __cyber_geo_command: 'fly_to_cve',
      cveId: cve.cve_id,
    };
  } catch (err) {
    return {
      error: `AEGIS CVE detail failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── aegis_score_threat_actor ─────────────────────────────────────────────────
// Threat actor scoring (capability/reach/recency/velocity/attribution + grade).

export async function aegisScoreThreatActor(input: Record<string, unknown>): Promise<unknown> {
  const actorQuery = input.actor as string;

  if (!actorQuery) {
    return { error: 'aegis_score_threat_actor: actor is required' };
  }

  try {
    // Try exact actor_id match first, then aliases array
    let actorResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_threat_actors WHERE actor_id = $1`,
      [actorQuery],
    );

    if (actorResult.rows.length === 0) {
      // Search aliases array (case-insensitive)
      actorResult = await query<Record<string, unknown>>(
        `SELECT * FROM aegis_threat_actors
         WHERE EXISTS (
           SELECT 1 FROM unnest(aliases) AS a WHERE LOWER(a) = LOWER($1)
         )
         OR LOWER(display_name) = LOWER($1)
         LIMIT 1`,
        [actorQuery],
      );
    }

    if (actorResult.rows.length === 0) {
      // Return top actors as suggestions
      const suggestions = await query<Record<string, unknown>>(
        `SELECT actor_id, display_name, actor_type, composite_score, actor_grade
         FROM aegis_v_actor_rankings
         LIMIT 10`,
      );
      return {
        error: `No threat actor found matching "${actorQuery}"`,
        suggestions: suggestions.rows.map((s) => ({
          actorId: s.actor_id,
          displayName: s.display_name,
          actorType: s.actor_type,
          compositeScore: s.composite_score,
          actorGrade: s.actor_grade,
        })),
      };
    }

    const actor = actorResult.rows[0]!;

    // Scores
    const scoresResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_threat_actor_scores WHERE actor_id = $1`,
      [actor.actor_id],
    );
    const scores = scoresResult.rows[0] ?? null;

    // Recent campaigns (last 3 by start_date DESC)
    const campaignsResult = await query<Record<string, unknown>>(
      `SELECT * FROM aegis_threat_actor_campaigns
       WHERE actor_id = $1
       ORDER BY start_date DESC NULLS LAST
       LIMIT 3`,
      [actor.actor_id],
    );

    // TTP count by tactic
    const ttpsResult = await query<Record<string, unknown>>(
      `SELECT mitre_tactic_id, COUNT(*) AS technique_count
       FROM aegis_threat_actor_ttps
       WHERE actor_id = $1
       GROUP BY mitre_tactic_id
       ORDER BY technique_count DESC`,
      [actor.actor_id],
    );

    // Total TTP count
    const totalTtpsResult = await query<Record<string, unknown>>(
      `SELECT COUNT(*) AS total FROM aegis_threat_actor_ttps WHERE actor_id = $1`,
      [actor.actor_id],
    );
    const totalTtps = (totalTtpsResult.rows[0]?.total as number) ?? 0;

    // Target count
    const targetsResult = await query<Record<string, unknown>>(
      `SELECT COUNT(*) AS total FROM aegis_threat_actor_targets WHERE actor_id = $1`,
      [actor.actor_id],
    );
    const targetCount = (targetsResult.rows[0]?.total as number) ?? 0;

    return {
      sourceUrl: `/api/aegis/threat-actors/view?id=${actor.actor_id}`,
      actor: {
        actorId: actor.actor_id,
        displayName: actor.display_name,
        aliases: actor.aliases,
        actorType: actor.actor_type,
        attributionCountry: actor.attribution_country,
        firstObservedAt: actor.first_observed_at,
        lastActiveAt: actor.last_active_at,
        motivation: actor.motivation,
        sophistication: actor.sophistication,
        summary: actor.summary,
        mitreGroupId: actor.mitre_group_id,
        references: actor.reference_urls,
      },
      scores: scores
        ? {
            capability: scores.capability_score,
            reach: scores.reach_score,
            recency: scores.recency_score,
            velocity: scores.velocity_score,
            attributionConfidence: scores.attribution_confidence,
            composite: scores.composite_score,
            grade: scores.actor_grade,
            tier: scores.actor_tier,
            lastUpdated: scores.last_updated,
          }
        : null,
      recentCampaigns: campaignsResult.rows.map((c) => ({
        campaignName: c.campaign_name,
        startDate: c.start_date,
        endDate: c.end_date,
        targetSectors: c.target_sectors,
        targetGeographies: c.target_geographies,
        summary: c.summary,
        cveIdsExploited: c.cve_ids_exploited,
        references: c.reference_urls,
      })),
      ttpsByTactic: ttpsResult.rows.map((t) => ({
        tacticId: t.mitre_tactic_id,
        techniqueCount: t.technique_count,
      })),
      summary: {
        totalCampaigns: campaignsResult.rows.length,
        totalTtps,
        totalTargets: targetCount,
      },
      // Client-side marker: fly the globe to this actor's footprint if loaded.
      __cyber_geo_command: 'fly_to_actor',
      actorId: actor.actor_id,
    };
  } catch (err) {
    return {
      error: `AEGIS threat actor scoring failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── aegis_find_incident_comps ────────────────────────────────────────────────
// Search historical incidents by industry, vector, blast radius.

export async function aegisFindIncidentComps(input: Record<string, unknown>): Promise<unknown> {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (input.industry) {
      conditions.push(`LOWER(i.industry) LIKE LOWER($${paramIdx++})`);
      params.push(`%${input.industry as string}%`);
    }
    if (input.country) {
      conditions.push(`LOWER(i.country) = LOWER($${paramIdx++})`);
      params.push(input.country as string);
    }
    if (input.incident_type) {
      conditions.push(`i.incident_type = $${paramIdx++}`);
      params.push(input.incident_type as string);
    }
    if (input.initial_access_vector) {
      conditions.push(`LOWER(i.initial_access_vector) LIKE LOWER($${paramIdx++})`);
      params.push(`%${input.initial_access_vector as string}%`);
    }
    if (input.actor_id) {
      conditions.push(`i.actor_id = $${paramIdx++}`);
      params.push(input.actor_id as string);
    }
    if (input.min_records != null) {
      conditions.push(`i.records_compromised >= $${paramIdx++}`);
      params.push(input.min_records as number);
    }
    if (input.since) {
      conditions.push(`i.disclosed_at >= $${paramIdx++}`);
      params.push(input.since as string);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min((input.limit as number) ?? 15, 30);

    const sql = `
      SELECT
        i.id, i.incident_id, i.organization, i.org_domain,
        i.industry, i.country,
        i.disclosed_at, i.incident_started_at, i.incident_ended_at,
        i.incident_type, i.initial_access_vector,
        i.actor_id, i.records_compromised, i.estimated_loss_usd,
        i.summary, i.reference_urls,
        a.display_name AS actor_name, a.actor_type,
        (SELECT COUNT(*) FROM aegis_incident_ttps_observed t WHERE t.incident_id = i.id) AS ttp_count
      FROM aegis_incidents i
      LEFT JOIN aegis_threat_actors a ON a.actor_id = i.actor_id
      ${whereClause}
      ORDER BY i.disclosed_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    const result = await query<Record<string, unknown>>(sql, params);

    // Summary stats
    const recordsArr = result.rows
      .map((r) => Number(r.records_compromised) || 0)
      .filter((n) => n > 0);
    const lossArr = result.rows
      .map((r) => (r.estimated_loss_usd as number) ?? 0)
      .filter((n) => n > 0);

    const avgRecords =
      recordsArr.length > 0
        ? Math.round(recordsArr.reduce((a, b) => a + b, 0) / recordsArr.length)
        : null;
    const avgLossUsd =
      lossArr.length > 0 ? Math.round(lossArr.reduce((a, b) => a + b, 0) / lossArr.length) : null;

    // Count by incident type
    const typeBreakdown: Record<string, number> = {};
    for (const r of result.rows) {
      const t = (r.incident_type as string) ?? 'unknown';
      typeBreakdown[t] = (typeBreakdown[t] ?? 0) + 1;
    }

    const topIncident = result.rows[0];

    return {
      sourceUrl: topIncident
        ? `/api/aegis/incidents/view?id=${topIncident.id}`
        : '/api/aegis/incidents/view',
      incidents: result.rows.map((r) => ({
        id: r.id,
        incidentId: r.incident_id,
        organization: r.organization,
        orgDomain: r.org_domain,
        industry: r.industry,
        country: r.country,
        disclosedAt: r.disclosed_at,
        incidentStartedAt: r.incident_started_at,
        incidentEndedAt: r.incident_ended_at,
        incidentType: r.incident_type,
        initialAccessVector: r.initial_access_vector,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorType: r.actor_type,
        recordsCompromised: r.records_compromised,
        estimatedLossUsd: r.estimated_loss_usd,
        ttpCount: r.ttp_count,
        summary: r.summary,
        references: r.reference_urls,
        sourceUrl: `/api/aegis/incidents/view?id=${r.id}`,
      })),
      matchedCount: result.rows.length,
      summary: {
        avgRecordsCompromised: avgRecords,
        avgLossUsd,
        typeBreakdown,
      },
    };
  } catch (err) {
    return {
      error: `AEGIS incident comps failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── aegis_run_risk_simulation ────────────────────────────────────────────────
// Monte Carlo over breach loss distributions — reuses atlas/monte-carlo engine.

export async function aegisRunRiskSimulation(input: Record<string, unknown>): Promise<unknown> {
  try {
    const { runMonteCarloSimulation } = await import('@/lib/aegis/monte-carlo');

    // Map cyber inputs to the CollateralInput shape used by the engine.
    // Security maturity grade maps directly to marketGrade (A=mature/low vol, D=nascent/high vol).
    const annualRevenue = (input.annual_revenue_usd as number) ?? 0;
    const headcount = (input.headcount as number) ?? 0;
    const securityGrade = ((input.security_maturity_grade as string) ?? 'B') as
      | 'A'
      | 'B'
      | 'C'
      | 'D';

    if (annualRevenue <= 0) {
      return {
        error: 'Cannot run simulation: annual_revenue_usd must be > 0',
        received: { annualRevenue, headcount, securityGrade },
      };
    }

    // The engine wants purchasePrice/noi. Map:
    //   purchasePrice ← annual revenue (acts as exposure base)
    //   noi          ← revenue × ~12% margin proxy (drives loss scaling)
    //   units        ← headcount
    //   capRate      ← 0.06 default (used internally for terminal value)
    //   occupancyPct ← 0.95 default
    //   yearBuilt    ← 2020 default
    const collateralInput = {
      purchasePrice: annualRevenue,
      noi: annualRevenue * 0.12,
      capRate: 0.06,
      units: headcount > 0 ? headcount : 1,
      yearBuilt: 2020,
      occupancyPct: 0.95,
      marketGrade: securityGrade,
    };

    const simConfig: { runs?: number; holdYears?: number; seed?: number } = {};
    if (input.runs) simConfig.runs = Math.min(input.runs as number, 5000);
    if (input.horizon_years) simConfig.holdYears = Math.min(input.horizon_years as number, 5);
    if (input.seed) simConfig.seed = input.seed as number;

    const results = runMonteCarloSimulation(collateralInput, simConfig);

    const fmtPct = (v: number) => +(v * 100).toFixed(2);
    const fmtMult = (v: number) => +v.toFixed(2);

    return {
      sourceUrl: '/api/aegis/risk-simulation/view',
      industry: input.industry ?? null,
      security_maturity_grade: securityGrade,
      profile: {
        annualRevenueUsd: annualRevenue,
        headcount,
        industry: input.industry ?? null,
      },
      irr: {
        p5: fmtPct(results.irr.p5),
        p25: fmtPct(results.irr.p25),
        p50: fmtPct(results.irr.p50),
        p75: fmtPct(results.irr.p75),
        p95: fmtPct(results.irr.p95),
      },
      moic: {
        p5: fmtMult(results.moic.p5),
        p25: fmtMult(results.moic.p25),
        p50: fmtMult(results.moic.p50),
        p75: fmtMult(results.moic.p75),
        p95: fmtMult(results.moic.p95),
      },
      dscr: {
        p5: fmtMult(results.dscr.p5),
        p25: fmtMult(results.dscr.p25),
        p50: fmtMult(results.dscr.p50),
        p75: fmtMult(results.dscr.p75),
        p95: fmtMult(results.dscr.p95),
      },
      probabilities: {
        riskAbove12Pct: fmtPct(results.probabilities.irrAbove12),
        riskAbove15Pct: fmtPct(results.probabilities.irrAbove15),
        lossPct: fmtPct(results.probabilities.loss),
        coverageBelow125Pct: fmtPct(results.probabilities.dscrBelow125),
      },
      stressScenarios: results.stressResults.map((s) => ({
        scenario: s.scenario,
        description: s.description,
        medianRiskPct: fmtPct(s.irrP50),
        medianMultiple: fmtMult(s.moicP50),
        probLossPct: fmtPct(s.probLoss),
      })),
      sensitivity: results.sensitivity.map((s) => ({
        variable: s.variable,
        impactPct: fmtPct(s.impact),
      })),
      config: {
        runs: results.config.runs,
        horizonYears: results.config.holdYears,
      },
      runTimeMs: Math.round(results.runTimeMs),
    };
  } catch (err) {
    return {
      error: `AEGIS risk simulation failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── aegis_match_defenses ─────────────────────────────────────────────────────
// Match defensive controls to a CVE, MITRE technique, or framework control.

export async function aegisMatchDefenses(input: Record<string, unknown>): Promise<unknown> {
  try {
    // At least one target must be specified
    const cveId = input.cve_id as string | undefined;
    const mitreTechniqueId = input.mitre_technique_id as string | undefined;
    const frameworkControl = input.framework_control as string | undefined;

    if (!cveId && !mitreTechniqueId && !frameworkControl) {
      return {
        error:
          'aegis_match_defenses: at least one of cve_id, mitre_technique_id, or framework_control is required',
      };
    }

    // Build the mapping target filter
    const mappingConditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (cveId) {
      mappingConditions.push(
        `(dm.mapping_type = 'mitigates_cve' AND dm.target_id = $${paramIdx++})`,
      );
      params.push(cveId);
    }
    if (mitreTechniqueId) {
      mappingConditions.push(
        `(dm.mapping_type = 'mitigates_technique' AND dm.target_id = $${paramIdx++})`,
      );
      params.push(mitreTechniqueId);
    }
    if (frameworkControl) {
      mappingConditions.push(
        `(dm.mapping_type = 'satisfies_control' AND dm.target_id = $${paramIdx++})`,
      );
      params.push(frameworkControl);
    }

    const conditions = [`(${mappingConditions.join(' OR ')})`];

    if (input.defense_type) {
      conditions.push(`d.defense_type = $${paramIdx++}`);
      params.push(input.defense_type as string);
    }
    if (input.cost_tier) {
      // Filter to defenses at or below the cost tier
      const tierOrder = ['free', 'low', 'mid', 'high'];
      const maxIdx = tierOrder.indexOf(input.cost_tier as string);
      if (maxIdx >= 0) {
        const allowed = tierOrder.slice(0, maxIdx + 1);
        conditions.push(`d.cost_tier = ANY($${paramIdx++}::text[])`);
        params.push(allowed);
      }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = Math.min((input.limit as number) ?? 15, 30);

    const sql = `
      SELECT
        d.id, d.defense_id, d.name, d.defense_type, d.vendor,
        d.cost_tier, d.complexity_tier, d.deployment_target,
        d.frameworks, d.summary, d.reference_urls,
        dm.mapping_type, dm.target_id, dm.efficacy_score, dm.evidence_url, dm.notes
      FROM aegis_defenses d
      JOIN aegis_defense_mappings dm ON dm.defense_id = d.id
      ${whereClause}
      ORDER BY dm.efficacy_score DESC NULLS LAST, d.name ASC
      LIMIT ${limit}
    `;

    const result = await query<Record<string, unknown>>(sql, params);

    // Pull characteristics for the returned defenses (single round-trip)
    const defenseIds = [...new Set(result.rows.map((r) => r.id as number))];
    let characteristics: Record<string, unknown>[] = [];
    if (defenseIds.length > 0) {
      const charResult = await query<Record<string, unknown>>(
        `SELECT * FROM aegis_defense_characteristics WHERE defense_id = ANY($1::int[])`,
        [defenseIds],
      );
      characteristics = charResult.rows;
    }

    // Group characteristics by defense_id
    const charsByDefense: Record<number, Record<string, unknown>[]> = {};
    for (const c of characteristics) {
      const did = c.defense_id as number;
      if (!charsByDefense[did]) charsByDefense[did] = [];
      charsByDefense[did].push({
        characteristicType: c.characteristic_type,
        valueNumeric: c.value_numeric,
        valueText: c.value_text,
      });
    }

    // Defense type breakdown
    const typeBreakdown: Record<string, number> = {};
    for (const r of result.rows) {
      const t = (r.defense_type as string) ?? 'unknown';
      typeBreakdown[t] = (typeBreakdown[t] ?? 0) + 1;
    }

    const topDefense = result.rows[0];

    return {
      sourceUrl: topDefense
        ? `/api/aegis/defenses/view?id=${topDefense.id}`
        : '/api/aegis/defenses/view',
      defenses: result.rows.map((r) => ({
        id: r.id,
        defenseId: r.defense_id,
        name: r.name,
        defenseType: r.defense_type,
        vendor: r.vendor,
        costTier: r.cost_tier,
        complexityTier: r.complexity_tier,
        deploymentTarget: r.deployment_target,
        frameworks: r.frameworks,
        summary: r.summary,
        references: r.reference_urls,
        mapping: {
          type: r.mapping_type,
          targetId: r.target_id,
          efficacyScore: r.efficacy_score,
          evidenceUrl: r.evidence_url,
          notes: r.notes,
        },
        characteristics: charsByDefense[r.id as number] ?? [],
        sourceUrl: `/api/aegis/defenses/view?id=${r.id}`,
      })),
      matchedCount: result.rows.length,
      typeBreakdown,
      target: {
        cveId: cveId ?? null,
        mitreTechniqueId: mitreTechniqueId ?? null,
        frameworkControl: frameworkControl ?? null,
      },
    };
  } catch (err) {
    return {
      error: `AEGIS defense match failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── aegis_screen_compromised_orgs ────────────────────────────────────────────
// Screen compromised orgs by industry, region, blast radius, ransom status.

export async function aegisScreenCompromisedOrgs(input: Record<string, unknown>): Promise<unknown> {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (input.industry) {
      conditions.push(`LOWER(o.industry) LIKE LOWER($${paramIdx++})`);
      params.push(`%${input.industry as string}%`);
    }
    if (input.country) {
      conditions.push(`LOWER(o.country) = LOWER($${paramIdx++})`);
      params.push(input.country as string);
    }
    if (input.state_region) {
      conditions.push(`LOWER(o.state_region) = LOWER($${paramIdx++})`);
      params.push(input.state_region as string);
    }
    if (input.has_active_ransom != null) {
      conditions.push(`o.has_active_ransom = $${paramIdx++}`);
      params.push(input.has_active_ransom as boolean);
    }
    if (input.min_records_compromised != null) {
      conditions.push(`o.total_records_compromised >= $${paramIdx++}`);
      params.push(input.min_records_compromised as number);
    }
    if (input.since) {
      conditions.push(`o.last_breach_at >= $${paramIdx++}`);
      params.push(input.since as string);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min((input.limit as number) ?? 20, 50);

    const sql = `
      SELECT
        o.id, o.org_name, o.org_domain, o.industry,
        o.country, o.state_region,
        o.breach_count, o.last_breach_at,
        o.total_records_compromised, o.has_active_ransom,
        o.enrichment_status, o.enrichment_source, o.notes,
        (SELECT COUNT(*) FROM aegis_breach_disclosures bd WHERE bd.org_id = o.id) AS disclosure_count
      FROM aegis_compromised_orgs o
      ${whereClause}
      ORDER BY o.last_breach_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    const result = await query<Record<string, unknown>>(sql, params);

    // Industry breakdown
    const industryBreakdown: Record<string, number> = {};
    for (const r of result.rows) {
      const ind = (r.industry as string) ?? 'unknown';
      industryBreakdown[ind] = (industryBreakdown[ind] ?? 0) + 1;
    }

    // Counts
    const activeRansomCount = result.rows.filter((r) => r.has_active_ransom === true).length;
    const totalRecords = result.rows.reduce(
      (acc, r) => acc + (Number(r.total_records_compromised) || 0),
      0,
    );

    const topOrg = result.rows[0];

    return {
      sourceUrl: topOrg
        ? `/api/aegis/compromised-orgs/view?id=${topOrg.id}`
        : '/api/aegis/compromised-orgs/view',
      orgs: result.rows.map((r) => ({
        id: r.id,
        orgName: r.org_name,
        orgDomain: r.org_domain,
        industry: r.industry,
        country: r.country,
        stateRegion: r.state_region,
        breachCount: r.breach_count,
        lastBreachAt: r.last_breach_at,
        totalRecordsCompromised: r.total_records_compromised,
        hasActiveRansom: r.has_active_ransom,
        enrichmentStatus: r.enrichment_status,
        enrichmentSource: r.enrichment_source,
        notes: r.notes,
        disclosureCount: r.disclosure_count,
        sourceUrl: `/api/aegis/compromised-orgs/view?id=${r.id}`,
      })),
      matchedCount: result.rows.length,
      industryBreakdown,
      summary: {
        activeRansomCount,
        totalRecordsCompromised: totalRecords,
      },
    };
  } catch (err) {
    return {
      error: `AEGIS compromised orgs screening failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ═══════════════════════════════════════════════
// PHASE 11.D.13 — FORECAST-AWARE AGENT TOOLS
// ═══════════════════════════════════════════════
// Four tools wrapping the Phase 11.B + 11.C forecasting models. Each
// returns a sourceUrl per rule #21 so the agent can cite the forecast in
// its response. Errors are returned as { error } strings (not thrown) so
// the tool-use loop never bails — matching the existing AEGIS handler
// convention above.

export async function aegisExploitForecast(input: Record<string, unknown>): Promise<unknown> {
  const cveId = String(input.cve_id ?? '').toUpperCase();
  if (!cveId || !/^CVE-\d{4}-\d+$/i.test(cveId)) {
    return { error: 'cve_id required (format CVE-YYYY-NNNNN)' };
  }
  try {
    // Logistic forecast inputs
    const { rows: cveRows } = await query<{
      cvss_v3_score: number | null;
      epss_percentile: number | null;
      published_at: string;
      severity: string | null;
      is_kev: boolean | null;
    }>(
      `SELECT cvss_v3_score, epss_percentile, published_at, severity, is_kev
         FROM aegis_cves WHERE cve_id = $1 LIMIT 1`,
      [cveId],
    );
    if (cveRows.length === 0) return { error: `CVE not found: ${cveId}` };
    const cve = cveRows[0]!;

    const { rows: productRows } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM aegis_affected_products WHERE cve_id = $1`,
      [cveId],
    );

    const logisticModel = await loadLogisticModel();
    const daysSincePublish = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(cve.published_at)) / (1000 * 60 * 60 * 24)),
    );
    const features: ExploitFeatures = {
      cvssV3: Number(cve.cvss_v3_score ?? logisticModel.featureMeans[0] ?? 7),
      epssPercentile: Number(cve.epss_percentile ?? 0.5),
      daysSincePublish,
      affectedProductPopularity: Number(productRows[0]?.n ?? 0),
      vendorPatchLagDays: null,
    };
    const logistic = forecastExploit(features, logisticModel);

    // HMM lifecycle
    const hmmModel = await loadHmmModel();
    const { rows: histRows } = await query<{ event_type: string | null }>(
      `SELECT event_type FROM aegis_cve_severity_history
         WHERE cve_id = $1 AND event_type IS NOT NULL
         ORDER BY observed_at ASC`,
      [cveId],
    );
    const knownEmissions = new Set<string>(EMISSIONS);
    const observations = histRows
      .map((r) => r.event_type as Emission)
      .filter((e): e is Emission => knownEmissions.has(e));
    const hmmResult = observations.length > 0 ? inferCveState(observations, hmmModel) : null;

    return {
      sourceUrl: `/api/aegis/cves/view?id=${encodeURIComponent(cveId)}`,
      cveId,
      severity: cve.severity,
      isKev: cve.is_kev ?? false,
      logistic: {
        pExploited30d: logistic.pExploited30d,
        pExploited60d: logistic.pExploited60d,
        pExploited90d: logistic.pExploited90d,
        confidenceInterval: { low: logistic.ciLow, high: logistic.ciHigh },
        modelVersion: logistic.modelVersion,
        featuresUsed: logistic.featuresUsed,
      },
      lifecycle: hmmResult
        ? {
            stateDistribution: {
              Discovered: hmmResult.stateDistribution[0],
              POC_Available: hmmResult.stateDistribution[1],
              Weaponized: hmmResult.stateDistribution[2],
              Mass_Exploitation: hmmResult.stateDistribution[3],
              Patched_Saturated: hmmResult.stateDistribution[4],
            },
            expectedDaysToMassExploitation: hmmResult.expectedDaysToState.Mass_Exploitation,
            modelVersion: hmmResult.modelVersion,
            observationCount: observations.length,
          }
        : { note: 'no lifecycle observations yet — HMM not run' },
    };
  } catch (err) {
    return {
      error: `aegis_exploit_forecast failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

export async function aegisActorForecast(input: Record<string, unknown>): Promise<unknown> {
  const actorParam = String(input.actor ?? '');
  if (!actorParam) return { error: 'actor required' };
  try {
    const { rows: actorRows } = await query<{ actor_id: string; display_name: string }>(
      `SELECT actor_id, display_name FROM aegis_threat_actors
         WHERE actor_id = $1 OR LOWER(display_name) = LOWER($1) OR $1 = ANY(aliases)
         LIMIT 1`,
      [actorParam],
    );
    if (actorRows.length === 0) return { error: `actor not found: ${actorParam}` };
    const actor = actorRows[0]!;

    const recentCutoffSec = 90 * 24 * 60 * 60;
    const { rows: sectorRows } = await query<{ category: string; is_recent: boolean }>(
      `SELECT industry AS category,
              CASE WHEN created_at IS NULL THEN FALSE
                ELSE EXTRACT(EPOCH FROM (NOW() - created_at::timestamptz)) <= $2
              END AS is_recent
         FROM aegis_threat_actor_targets
         WHERE actor_id = $1 AND industry IS NOT NULL`,
      [actor.actor_id, recentCutoffSec],
    );
    const { rows: countryRows } = await query<{ category: string; is_recent: boolean }>(
      // Schema gotcha: column is `geography`, not `country`
      `SELECT geography AS category,
              CASE WHEN created_at IS NULL THEN FALSE
                ELSE EXTRACT(EPOCH FROM (NOW() - created_at::timestamptz)) <= $2
              END AS is_recent
         FROM aegis_threat_actor_targets
         WHERE actor_id = $1 AND geography IS NOT NULL`,
      [actor.actor_id, recentCutoffSec],
    );

    const sectorObs = aggregateObservations(
      sectorRows.map((r) => ({ category: r.category, isRecent: r.is_recent })),
    );
    const countryObs = aggregateObservations(
      countryRows.map((r) => ({ category: r.category, isRecent: r.is_recent })),
    );

    return {
      sourceUrl: `/api/aegis/threat-actors/view?id=${encodeURIComponent(actor.actor_id)}`,
      actorId: actor.actor_id,
      actorDisplayName: actor.display_name,
      nextTargetSectors: sectorObs.length > 0 ? forecastFromObservations(sectorObs) : null,
      nextTargetCountries: countryObs.length > 0 ? forecastFromObservations(countryObs) : null,
    };
  } catch (err) {
    return {
      error: `aegis_actor_forecast failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

export async function aegisTimeseries(input: Record<string, unknown>): Promise<unknown> {
  const metric = String(input.metric ?? 'kev_adds') as Metric;
  const horizon = Number.parseInt(String(input.horizon_days ?? '30'), 10);
  if (!(METRICS as readonly string[]).includes(metric)) {
    return { error: `invalid metric — must be one of ${(METRICS as readonly string[]).join('|')}` };
  }
  if (![7, 30, 90].includes(horizon)) {
    return { error: 'invalid horizon_days — must be 7, 30, or 90' };
  }
  try {
    const { rows } = await query<{ date: string; value: number }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, ${metric} AS value
         FROM aegis_daily_metrics
         WHERE date >= CURRENT_DATE - INTERVAL '365 days'
         ORDER BY date ASC`,
    );
    const history: DailyValue[] = rows.map((r) => ({
      date: r.date,
      value: Number(r.value) || 0,
    }));
    const forecast = forecastMetric(metric, history, horizon);
    return {
      sourceUrl: `/api/aegis/predictions/timeseries?metric=${metric}&horizonDays=${horizon}`,
      metric,
      horizonDays: horizon,
      sampleSize: history.length,
      forecast,
    };
  } catch (err) {
    return { error: `aegis_timeseries failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function aegisCounterfactual(input: Record<string, unknown>): Promise<unknown> {
  const interventionRaw = input.intervention as { variable?: unknown; value?: unknown } | undefined;
  const targetRaw = String(input.target ?? 'BreachDisclosure');
  const evidenceRaw = (input.evidence as Record<string, unknown> | undefined) ?? {};

  if (
    !interventionRaw ||
    typeof interventionRaw.variable !== 'string' ||
    typeof interventionRaw.value !== 'string'
  ) {
    return { error: 'intervention.{variable,value} required as strings' };
  }
  if (!(VARIABLES as readonly string[]).includes(targetRaw)) {
    return {
      error: `invalid target — must be one of ${(VARIABLES as readonly string[]).join('|')}`,
    };
  }

  const model = buildCausalModel();
  const interventionVar = interventionRaw.variable;
  const interventionVal = interventionRaw.value;
  if (!(VARIABLES as readonly string[]).includes(interventionVar)) {
    return { error: `unknown intervention.variable: ${interventionVar}` };
  }
  const domain = model.domains[interventionVar as Variable];
  if (!domain.includes(interventionVal)) {
    return {
      error: `unknown intervention.value '${interventionVal}' — domain: ${domain.join('|')}`,
    };
  }

  // Filter evidence to known (variable, value) pairs only — silently drop unknowns
  const evidence: Partial<Record<Variable, string>> = {};
  for (const [k, v] of Object.entries(evidenceRaw)) {
    if (typeof v !== 'string') continue;
    if (!(VARIABLES as readonly string[]).includes(k)) continue;
    const evDomain = model.domains[k as Variable];
    if (!evDomain.includes(v)) continue;
    evidence[k as Variable] = v;
  }

  try {
    const result = doIntervene(
      {
        evidence,
        intervention: { variable: interventionVar as Variable, value: interventionVal },
        target: targetRaw as Variable,
      },
      model,
    );
    return {
      sourceUrl: '/api/aegis/predictions/counterfactual',
      modelVersion: model.version,
      result,
    };
  } catch (err) {
    return {
      error: `aegis_counterfactual failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── aegis_recent_alerts ──────────────────────────────────────────────────────
// The live alert board. This is what lets Max answer "what's alerting right
// now" — before the alert spine existed, `AgentContext.activeAlerts` was
// permanently empty and the agent had no way to see its own alert stream.

export async function aegisRecentAlerts(input: Record<string, unknown>): Promise<unknown> {
  const { listPipelineAlerts } = await import('@/lib/db/queries/pipeline-alerts');
  const { toAlertHistoryItem } = await import('@/lib/aegis/alert-mapper');

  const severityFilter = Array.isArray(input.severity)
    ? (input.severity as string[])
    : typeof input.severity === 'string'
      ? [input.severity as string]
      : undefined;

  const rows = await listPipelineAlerts({
    severities: severityFilter,
    sinceHours: typeof input.since_hours === 'number' ? input.since_hours : undefined,
    statuses:
      input.include_handled === true ? ['new', 'triaging', 'escalated', 'resolved'] : undefined,
    limit: Math.min(typeof input.limit === 'number' ? input.limit : 20, 50),
  });

  const alerts = rows.map((row) => {
    const item = toAlertHistoryItem(row);
    return {
      id: item.id,
      alertType: item.alertType,
      severity: item.severity,
      headline: item.title,
      summary: item.summary,
      entityKind: item.entityKind,
      entityId: item.entityId,
      status: item.status,
      publishedAt: item.createdAt,
      sourceUrl: item.sourceUrl,
    };
  });

  const bySeverity = alerts.reduce<Record<string, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});

  return {
    alerts,
    total: alerts.length,
    severityBreakdown: bySeverity,
    unhandled: alerts.filter((a) => a.status === 'new').length,
    sourceUrl: '/api/data/alerts',
  };
}

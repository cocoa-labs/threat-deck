import { fetchMitreAttackGroups } from '@/lib/data/collectors/mitre-attack';
import { dataProvenance } from '@/lib/data/provenance';
import { query, queryOne } from '@/lib/db/client';
import { recordRun } from './cursor';
import type { IngestSummary } from './ingest-cves';

/** Import attributed MITRE profiles. Scores and analyst classifications remain operator-owned. */
export async function ingestThreatActors(): Promise<IngestSummary> {
  let upserted = 0;
  try {
    const groups = await fetchMitreAttackGroups();
    const provenance = dataProvenance(groups);
    if (provenance.state !== 'live' || provenance.fetchedAt === null || !groups.length)
      throw new Error('mitre_source_unavailable');
    for (const group of groups) {
      if (!group.mitreGroupId || !/^G\d{4}$/.test(group.mitreGroupId))
        throw new Error('mitre_invalid_group');
      const existing = await queryOne<{ actor_id: string }>(
        'SELECT actor_id FROM aegis_threat_actors WHERE mitre_group_id = $1 OR actor_id = $1 ORDER BY actor_id LIMIT 1',
        [group.mitreGroupId],
      );
      await query(
        `INSERT INTO aegis_threat_actors
          (actor_id, display_name, aliases, actor_type, summary, mitre_group_id, reference_urls)
         VALUES ($1, $2, $3, 'unknown', $4, $5, $6)
         ON CONFLICT (actor_id) DO UPDATE SET
           display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases,
           summary = EXCLUDED.summary, mitre_group_id = EXCLUDED.mitre_group_id,
           reference_urls = EXCLUDED.reference_urls, updated_at = NOW()`,
        [
          existing?.actor_id ?? group.mitreGroupId,
          group.displayName,
          group.aliases ?? [],
          group.summary ?? null,
          group.mitreGroupId,
          group.references ?? [],
        ],
      );
      // STIX created/modified timestamps are document dates, not observed actor activity.
      // Do not manufacture activity dates, risk scores, countries, or campaigns from them.
      upserted++;
    }
    await recordRun('threat-actors', {
      count: upserted,
      ok: true,
      acquiredAt: provenance.fetchedAt,
    });
    return { source: 'threat-actors', upserted, ok: true };
  } catch (error) {
    await recordRun('threat-actors', {
      count: upserted,
      ok: false,
      error: error instanceof Error ? error.message : 'mitre_ingest_failed',
    });
    return { source: 'threat-actors', upserted, ok: false, reason: 'error' };
  }
}

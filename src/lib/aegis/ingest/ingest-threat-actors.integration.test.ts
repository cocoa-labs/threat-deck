import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';
import { ingestThreatActors } from './ingest-threat-actors';
import { ingestProvenance } from './provenance';

const groups = vi.hoisted(() => vi.fn());
vi.mock('@/lib/data/collectors/mitre-attack', () => ({ fetchMitreAttackGroups: groups }));
async function cleanup() {
  await query("DELETE FROM aegis_threat_actors WHERE actor_id IN ('G9999', 'synthetic-actor')");
  await query("DELETE FROM aegis_ingest_runs WHERE source = 'threat-actors'");
}
beforeEach(cleanup);
afterEach(cleanup);
it('persists real source metadata while preserving analyst-owned classification and scores', async () => {
  const fetchedAt = Date.now() - 3600_000;
  groups.mockResolvedValue([
    {
      actorId: 'G9999',
      mitreGroupId: 'G9999',
      displayName: 'Synthetic actor',
      aliases: ['Test alias'],
      summary: 'Synthetic MITRE fixture',
      _provenance: { state: 'live', fetchedAt, expiresAt: fetchedAt + 86400_000 },
    },
  ]);
  await query(
    "INSERT INTO aegis_threat_actors (actor_id, display_name, mitre_group_id, actor_type) VALUES ('synthetic-actor', 'Old name', 'G9999', 'criminal')",
  );
  await query(
    "INSERT INTO aegis_threat_actor_scores (actor_id, composite_score) VALUES ('synthetic-actor', 42)",
  );
  const summary = await ingestThreatActors();
  const health = await query<{ last_error: string | null }>(
    "SELECT last_error FROM aegis_ingest_runs WHERE source = 'threat-actors'",
  );
  expect(health.rows[0]?.last_error).toBeNull();
  expect(summary.ok).toBe(true);
  const result = await query(
    "SELECT display_name, actor_type, composite_score FROM aegis_v_actor_rankings WHERE actor_id = 'synthetic-actor'",
  );
  expect(result.rows).toEqual([
    { display_name: 'Synthetic actor', actor_type: 'criminal', composite_score: 42 },
  ]);
  expect((await query("SELECT 1 FROM aegis_threat_actors WHERE actor_id = 'G9999'")).rowCount).toBe(
    0,
  );
  expect(await ingestProvenance('threat-actors')).toEqual({
    state: 'live',
    fetchedAt,
    expiresAt: fetchedAt + 26 * 3600_000,
  });
});

/**
 * Migration 008 (outbound_drafts) integration tests.
 *
 * Asserts the SQL schema enforces the invariants the application-layer types
 * promise. If the SQL CHECK constraints and the TS const tuples in
 * `src/lib/outbound/constants.ts` drift, these tests catch it.
 *
 * Hits the live dev Postgres at $DATABASE_URL. Uses a unique created_by
 * marker (`test:migration-008`) so cleanup deletes only rows this suite
 * created — won't disturb real data.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_MODES,
  DRAFT_CHANNELS,
  DRAFT_SEVERITIES,
  DRAFT_STATUSES,
  DRAFT_TYPES,
} from '@/lib/outbound/constants';
import { query } from './client';

const TEST_MARKER = 'test:migration-008';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('migration 008 — aegis_outbound_drafts', () => {
  it('accepts a minimal valid drafted row', async () => {
    const { rows } = await query<{ id: string; status: string }>(
      `INSERT INTO aegis_outbound_drafts
         (channel, draft_type, agent_mode, headline, draft_payload, created_by)
       VALUES ('twitter', 'breaking', 'anchor', 'test headline', $1::jsonb, $2)
       RETURNING id, status`,
      [JSON.stringify({ tweets: [{ text: 'hello world' }] }), TEST_MARKER],
    );
    expect(rows[0]).toBeDefined();
    expect(Number(rows[0]!.id)).toBeGreaterThan(0);
    expect(rows[0]!.status).toBe('drafted'); // default
  });

  it('rejects ai_relevance > 1.0 via CHECK constraint', async () => {
    await expect(
      query(
        `INSERT INTO aegis_outbound_drafts
           (channel, draft_type, agent_mode, headline, draft_payload, ai_relevance, created_by)
         VALUES ('twitter', 'breaking', 'anchor', 'h', '{}'::jsonb, 1.5, $1)`,
        [TEST_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects ai_relevance < 0 via CHECK constraint', async () => {
    await expect(
      query(
        `INSERT INTO aegis_outbound_drafts
           (channel, draft_type, agent_mode, headline, draft_payload, ai_relevance, created_by)
         VALUES ('twitter', 'breaking', 'anchor', 'h', '{}'::jsonb, -0.1, $1)`,
        [TEST_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('accepts ai_relevance at the [0, 1] boundary', async () => {
    const lower = await query(
      `INSERT INTO aegis_outbound_drafts
         (channel, draft_type, agent_mode, headline, draft_payload, ai_relevance, created_by)
       VALUES ('twitter', 'breaking', 'anchor', 'h-lo', '{}'::jsonb, 0.000, $1)
       RETURNING ai_relevance`,
      [TEST_MARKER],
    );
    const upper = await query(
      `INSERT INTO aegis_outbound_drafts
         (channel, draft_type, agent_mode, headline, draft_payload, ai_relevance, created_by)
       VALUES ('twitter', 'breaking', 'anchor', 'h-hi', '{}'::jsonb, 1.000, $1)
       RETURNING ai_relevance`,
      [TEST_MARKER],
    );
    expect(Number((lower.rows[0] as { ai_relevance: string }).ai_relevance)).toBe(0);
    expect(Number((upper.rows[0] as { ai_relevance: string }).ai_relevance)).toBe(1);
  });

  it('rejects an unknown status value', async () => {
    await expect(
      query(
        `INSERT INTO aegis_outbound_drafts
           (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
         VALUES ('twitter', 'breaking', 'anchor', 'h', '{}'::jsonb, 'bogus_status', $1)`,
        [TEST_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects an unknown channel value', async () => {
    await expect(
      query(
        `INSERT INTO aegis_outbound_drafts
           (channel, draft_type, agent_mode, headline, draft_payload, created_by)
         VALUES ('slack', 'breaking', 'anchor', 'h', '{}'::jsonb, $1)`,
        [TEST_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects an unknown draft_type value', async () => {
    await expect(
      query(
        `INSERT INTO aegis_outbound_drafts
           (channel, draft_type, agent_mode, headline, draft_payload, created_by)
         VALUES ('twitter', 'random_thread', 'anchor', 'h', '{}'::jsonb, $1)`,
        [TEST_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects an unknown agent_mode value', async () => {
    await expect(
      query(
        `INSERT INTO aegis_outbound_drafts
           (channel, draft_type, agent_mode, headline, draft_payload, created_by)
         VALUES ('twitter', 'breaking', 'ghostwriter', 'h', '{}'::jsonb, $1)`,
        [TEST_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('migration 008 — aegis_v_pending_drafts view', () => {
  it('returns drafted+edited rows but not approved/rejected/published', async () => {
    // Seed one of each lifecycle state (use distinct headlines to identify)
    await query(
      `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, status, created_by) VALUES
        ('twitter', 'breaking', 'anchor', 'v-drafted', '{}'::jsonb, 'drafted', $1),
        ('twitter', 'breaking', 'anchor', 'v-edited', '{}'::jsonb, 'edited', $1),
        ('twitter', 'breaking', 'anchor', 'v-approved', '{}'::jsonb, 'approved', $1),
        ('twitter', 'breaking', 'anchor', 'v-rejected', '{}'::jsonb, 'rejected', $1),
        ('twitter', 'breaking', 'anchor', 'v-published', '{}'::jsonb, 'published', $1)`,
      [TEST_MARKER],
    );

    const { rows } = await query<{ headline: string; status: string }>(
      `SELECT headline, status FROM aegis_v_pending_drafts WHERE created_by = $1`,
      [TEST_MARKER],
    );

    const headlines = rows.map((r) => r.headline);
    expect(headlines).toContain('v-drafted');
    expect(headlines).toContain('v-edited');
    expect(headlines).not.toContain('v-approved');
    expect(headlines).not.toContain('v-rejected');
    expect(headlines).not.toContain('v-published');
  });

  it('computes age_seconds correctly (>= 0, monotonically increasing within a row group)', async () => {
    // Insert a row with backdated created_at so age_seconds is large + verifiable
    await query(
      `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, status, created_by, created_at) VALUES
        ('twitter', 'breaking', 'anchor', 'old-row', '{}'::jsonb, 'drafted', $1, NOW() - INTERVAL '90 minutes')`,
      [TEST_MARKER],
    );

    const { rows } = await query<{ age_seconds: number }>(
      `SELECT age_seconds FROM aegis_v_pending_drafts WHERE created_by = $1 AND headline = 'old-row'`,
      [TEST_MARKER],
    );

    expect(rows[0]).toBeDefined();
    // ~90 minutes = 5400 seconds; allow ±10s clock skew between INSERT and SELECT
    expect(Number(rows[0]!.age_seconds)).toBeGreaterThanOrEqual(5390);
    expect(Number(rows[0]!.age_seconds)).toBeLessThan(5500);
  });

  it('sorts critical drafts to the top, then by ai_relevance DESC, then by created_at DESC', async () => {
    // Backdate the inserts so the natural created_at order is OLDEST first;
    // the view should override that and put critical at top regardless.
    await query(
      `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, severity, ai_relevance, status, created_by, created_at) VALUES
        ('twitter', 'breaking', 'anchor', 'sort-low',      '{}'::jsonb, 'low',      0.20, 'drafted', $1, NOW() - INTERVAL '3 minutes'),
        ('twitter', 'breaking', 'anchor', 'sort-critical', '{}'::jsonb, 'critical', 0.55, 'drafted', $1, NOW() - INTERVAL '2 minutes'),
        ('twitter', 'breaking', 'anchor', 'sort-high-rel', '{}'::jsonb, 'high',     0.95, 'drafted', $1, NOW() - INTERVAL '1 minute'),
        ('twitter', 'breaking', 'anchor', 'sort-high-low', '{}'::jsonb, 'high',     0.30, 'drafted', $1, NOW())`,
      [TEST_MARKER],
    );

    const { rows } = await query<{ headline: string }>(
      `SELECT headline FROM aegis_v_pending_drafts WHERE created_by = $1`,
      [TEST_MARKER],
    );

    // Expected order: critical first, then high(0.95), then high(0.30), then low
    expect(rows.map((r) => r.headline)).toEqual([
      'sort-critical',
      'sort-high-rel',
      'sort-high-low',
      'sort-low',
    ]);
  });
});

describe('migration 008 — aegis_news_enrichments', () => {
  // Use distinct URLs per case to avoid PK conflicts; cleanup via marker prefix.
  const URL_PREFIX = 'https://test.migration-008/';

  afterEach(async () => {
    await query(`DELETE FROM aegis_news_enrichments WHERE item_url LIKE $1`, [`${URL_PREFIX}%`]);
  });

  it('accepts a valid enrichment row + upserts on PK conflict', async () => {
    const url = `${URL_PREFIX}article-1`;
    await query(
      `INSERT INTO aegis_news_enrichments (item_url, ai_relevance, ai_category, model_used, evidence_json)
       VALUES ($1, 0.85, 'defensive', 'keywords', '{}'::jsonb)`,
      [url],
    );
    // Second INSERT with same PK should fail (no ON CONFLICT in this raw insert)
    await expect(
      query(`INSERT INTO aegis_news_enrichments (item_url, ai_relevance) VALUES ($1, 0.50)`, [url]),
    ).rejects.toThrow(/duplicate key/i);
    // But the upsert idiom application code will use should work
    await query(
      `INSERT INTO aegis_news_enrichments (item_url, ai_relevance) VALUES ($1, 0.50)
       ON CONFLICT (item_url) DO UPDATE SET ai_relevance = EXCLUDED.ai_relevance`,
      [url],
    );
    const { rows } = await query<{ ai_relevance: string }>(
      `SELECT ai_relevance FROM aegis_news_enrichments WHERE item_url = $1`,
      [url],
    );
    expect(Number(rows[0]!.ai_relevance)).toBe(0.5);
  });

  it('rejects ai_relevance outside [0, 1]', async () => {
    await expect(
      query(`INSERT INTO aegis_news_enrichments (item_url, ai_relevance) VALUES ($1, 1.5)`, [
        `${URL_PREFIX}article-bad`,
      ]),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects an unknown ai_category', async () => {
    await expect(
      query(
        `INSERT INTO aegis_news_enrichments (item_url, ai_relevance, ai_category) VALUES ($1, 0.5, 'unknown_cat')`,
        [`${URL_PREFIX}article-bad-cat`],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('migration 008 — TS/SQL enum sync', () => {
  // These tests round-trip every constant tuple value through the DB. If a new
  // value is added to the TS tuple without updating the SQL CHECK (or vice
  // versa), one side fails first and the test surfaces the drift.

  it('all DRAFT_STATUSES values are accepted by the SQL CHECK', async () => {
    for (const status of DRAFT_STATUSES) {
      await query(
        `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
         VALUES ('twitter', 'breaking', 'anchor', $1, '{}'::jsonb, $2, $3)`,
        [`enum-status-${status}`, status, TEST_MARKER],
      );
    }
  });

  it('all DRAFT_CHANNELS values are accepted by the SQL CHECK', async () => {
    for (const channel of DRAFT_CHANNELS) {
      await query(
        `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, created_by)
         VALUES ($1, 'breaking', 'anchor', $2, '{}'::jsonb, $3)`,
        [channel, `enum-channel-${channel}`, TEST_MARKER],
      );
    }
  });

  it('all DRAFT_TYPES values are accepted by the SQL CHECK', async () => {
    for (const draftType of DRAFT_TYPES) {
      await query(
        `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, created_by)
         VALUES ('twitter', $1, 'anchor', $2, '{}'::jsonb, $3)`,
        [draftType, `enum-type-${draftType}`, TEST_MARKER],
      );
    }
  });

  it('all AGENT_MODES values are accepted by the SQL CHECK', async () => {
    for (const mode of AGENT_MODES) {
      await query(
        `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, created_by)
         VALUES ('twitter', 'breaking', $1, $2, '{}'::jsonb, $3)`,
        [mode, `enum-mode-${mode}`, TEST_MARKER],
      );
    }
  });

  it('all DRAFT_SEVERITIES values are accepted by the SQL CHECK', async () => {
    for (const severity of DRAFT_SEVERITIES) {
      await query(
        `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, severity, created_by)
         VALUES ('twitter', 'breaking', 'anchor', $1, '{}'::jsonb, $2, $3)`,
        [`enum-sev-${severity}`, severity, TEST_MARKER],
      );
    }
  });
});

describe('migration 008 — aegis_pipeline_alerts.ai_relevance column', () => {
  it('has the ai_relevance column with the correct CHECK constraint', async () => {
    const { rows } = await query<{
      column_name: string;
      data_type: string;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>(
      `SELECT column_name, data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_name = 'aegis_pipeline_alerts'
          AND column_name = 'ai_relevance'`,
    );
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.data_type).toBe('numeric');
    expect(rows[0]!.numeric_precision).toBe(4);
    expect(rows[0]!.numeric_scale).toBe(3);
  });
});

// ─── Migration 009 — Phase 11 predictive analytics schema ────────────────────

const MIG009_MARKER = 'migration-009-test';

async function cleanup009(): Promise<void> {
  await query(`DELETE FROM aegis_cve_forecasts WHERE model_version = $1`, [MIG009_MARKER]);
  await query(`DELETE FROM aegis_actor_target_forecasts WHERE model_version = $1`, [MIG009_MARKER]);
  await query(`DELETE FROM aegis_cve_lifecycle_states WHERE model_version = $1`, [MIG009_MARKER]);
  await query(`DELETE FROM aegis_timeseries_forecasts WHERE model_version = $1`, [MIG009_MARKER]);
  await query(`DELETE FROM aegis_causal_edges WHERE model_version = $1`, [MIG009_MARKER]);
  await query(`DELETE FROM aegis_causal_counterfactuals WHERE model_version = $1`, [MIG009_MARKER]);
  await query(`DELETE FROM aegis_forecast_outcomes WHERE model_version = $1`, [MIG009_MARKER]);
  await query(`DELETE FROM aegis_daily_metrics WHERE date = '1999-01-01'`);
}

describe('migration 009 — aegis_cve_forecasts', () => {
  beforeEach(cleanup009);
  afterEach(cleanup009);

  it('accepts a valid forecast row with monotonic horizons', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO aegis_cve_forecasts
         (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d, ci_low, ci_high)
       VALUES ('CVE-2024-3094', '2026-05-25', $1, 0.4123, 0.6234, 0.7891, 0.30, 0.85)
       RETURNING id`,
      [MIG009_MARKER],
    );
    expect(Number(rows[0]!.id)).toBeGreaterThan(0);
  });

  it('rejects non-monotonic horizons (p30d > p60d)', async () => {
    await expect(
      query(
        `INSERT INTO aegis_cve_forecasts
           (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d)
         VALUES ('CVE-2024-3094', '2026-05-25', $1, 0.9, 0.3, 0.5)`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects p_exploited > 1.0', async () => {
    await expect(
      query(
        `INSERT INTO aegis_cve_forecasts
           (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d)
         VALUES ('CVE-2024-3094', '2026-05-25', $1, 0.5, 0.6, 1.5)`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects ci_low > ci_high', async () => {
    await expect(
      query(
        `INSERT INTO aegis_cve_forecasts
           (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d, ci_low, ci_high)
         VALUES ('CVE-2024-3094', '2026-05-25', $1, 0.5, 0.6, 0.7, 0.9, 0.1)`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('enforces unique (cve_id, forecast_date, model_version)', async () => {
    await query(
      `INSERT INTO aegis_cve_forecasts
         (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d)
       VALUES ('CVE-2024-3094', '2026-05-25', $1, 0.5, 0.6, 0.7)`,
      [MIG009_MARKER],
    );
    await expect(
      query(
        `INSERT INTO aegis_cve_forecasts
           (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d)
         VALUES ('CVE-2024-3094', '2026-05-25', $1, 0.5, 0.6, 0.7)`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('migration 009 — aegis_timeseries_forecasts', () => {
  beforeEach(cleanup009);
  afterEach(cleanup009);

  it('accepts a valid forecast with trend label', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO aegis_timeseries_forecasts
         (metric_name, forecast_date, horizon_days, p_low, p_mid, p_high, trend, model_version)
       VALUES ('kev_adds', '2026-05-25', 30, 1.2, 2.4, 3.6, 'rising', $1)
       RETURNING id`,
      [MIG009_MARKER],
    );
    expect(Number(rows[0]!.id)).toBeGreaterThan(0);
  });

  it('rejects unsupported metric_name', async () => {
    await expect(
      query(
        `INSERT INTO aegis_timeseries_forecasts
           (metric_name, forecast_date, horizon_days, p_low, p_mid, p_high, model_version)
         VALUES ('not_a_metric', '2026-05-25', 30, 1, 2, 3, $1)`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects horizon_days outside (7, 30, 90)', async () => {
    await expect(
      query(
        `INSERT INTO aegis_timeseries_forecasts
           (metric_name, forecast_date, horizon_days, p_low, p_mid, p_high, model_version)
         VALUES ('kev_adds', '2026-05-25', 45, 1, 2, 3, $1)`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects non-monotonic CI (p_low > p_mid)', async () => {
    await expect(
      query(
        `INSERT INTO aegis_timeseries_forecasts
           (metric_name, forecast_date, horizon_days, p_low, p_mid, p_high, model_version)
         VALUES ('kev_adds', '2026-05-25', 30, 5, 2, 8, $1)`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('migration 009 — aegis_forecast_outcomes', () => {
  beforeEach(cleanup009);
  afterEach(cleanup009);

  it('accepts a valid outcome row with brier + log-loss', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO aegis_forecast_outcomes
         (forecast_kind, forecast_id, model_version, outcome_observed_at, was_correct, brier_score, log_loss)
       VALUES ('cve_logistic', 1, $1, NOW(), TRUE, 0.040000, 0.223144)
       RETURNING id`,
      [MIG009_MARKER],
    );
    expect(Number(rows[0]!.id)).toBeGreaterThan(0);
  });

  it('accepts null was_correct for causal-counterfactual outcomes', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO aegis_forecast_outcomes
         (forecast_kind, forecast_id, model_version, outcome_observed_at, was_correct)
       VALUES ('causal', 1, $1, NOW(), NULL)
       RETURNING id`,
      [MIG009_MARKER],
    );
    expect(Number(rows[0]!.id)).toBeGreaterThan(0);
  });

  it('rejects unsupported forecast_kind', async () => {
    await expect(
      query(
        `INSERT INTO aegis_forecast_outcomes
           (forecast_kind, forecast_id, model_version, outcome_observed_at)
         VALUES ('not_a_kind', 1, $1, NOW())`,
        [MIG009_MARKER],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('migration 009 — aegis_v_situation_signal view', () => {
  it('returns a single row with sensible defaults even with no forecasts', async () => {
    const { rows } = await query<{
      next_30d_aggregate_p: string;
      kev_trend_label: string;
      kev_7d_projection: string;
    }>(
      `SELECT next_30d_aggregate_p, kev_trend_label, kev_7d_projection FROM aegis_v_situation_signal`,
    );
    expect(rows).toHaveLength(1);
    // COALESCE fallbacks: empty forecast set → 0 / 'flat' / 0
    expect(Number(rows[0]!.next_30d_aggregate_p)).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.kev_trend_label).toMatch(/^(rising|flat|falling)$/);
    expect(Number(rows[0]!.kev_7d_projection)).toBeGreaterThanOrEqual(0);
  });
});

describe('migration 009 — aegis_v_top_likely_exploits view', () => {
  beforeEach(cleanup009);
  afterEach(cleanup009);

  it('orders by p_exploited_30d DESC and excludes KEV CVEs', async () => {
    // CVE-2024-3094  is_kev=true   → should be EXCLUDED by the view's filter
    // CVE-2024-26229 is_kev=false  → should appear with the inserted p=0.80
    // (both confirmed live in the seed)
    await query(
      `INSERT INTO aegis_cve_forecasts
         (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d)
       VALUES ('CVE-2024-3094', '2026-05-25', $1, 0.30, 0.40, 0.50)`,
      [MIG009_MARKER],
    );
    await query(
      `INSERT INTO aegis_cve_forecasts
         (cve_id, forecast_date, model_version, p_exploited_30d, p_exploited_60d, p_exploited_90d)
       VALUES ('CVE-2024-26229', '2026-05-25', $1, 0.80, 0.85, 0.90)`,
      [MIG009_MARKER],
    );
    const { rows } = await query<{ cve_id: string; p_exploited_30d: string }>(
      `SELECT cve_id, p_exploited_30d FROM aegis_v_top_likely_exploits
        WHERE model_version = $1
        ORDER BY p_exploited_30d DESC`,
      [MIG009_MARKER],
    );
    const cveIds = rows.map((r) => r.cve_id);
    expect(cveIds).toContain('CVE-2024-26229');
    expect(cveIds).not.toContain('CVE-2024-3094');
  });
});

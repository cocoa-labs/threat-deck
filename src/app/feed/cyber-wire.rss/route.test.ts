/**
 * Tests for the AI Cyber Wire RSS feed narrowing.
 *
 * Canonical query (no `?include`) filters to
 * `(ai_relevance >= 0.5 OR severity = 'critical')`. The `?include=all`
 * escape hatch restores the pre-Phase-9 broad-cyber view.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { GET } from './route';

const TEST_MARKER = 'test-cw-9.6';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_pipeline_alerts WHERE headline LIKE '${TEST_MARKER}-%'`);
}

async function seedAlert(opts: {
  severity: string;
  aiRelevance: number | null;
  headlineSuffix: string;
}): Promise<void> {
  // Phase 13.011 migrated published_at from TEXT to TIMESTAMPTZ. Drop
  // the explicit ::text cast (would fail with a column-type mismatch).
  await query(
    `INSERT INTO aegis_pipeline_alerts
       (alert_type, entity_kind, entity_id, severity, headline, summary, published_at, ai_relevance)
     VALUES ('cve_disclosure', 'cve', $1, $2, $3, 'test summary', NOW(), $4)`,
    [
      `CVE-TEST-${Math.floor(Math.random() * 1e9)}`,
      opts.severity,
      `${TEST_MARKER}-${opts.headlineSuffix}`,
      opts.aiRelevance,
    ],
  );
}

beforeEach(cleanup);
afterEach(cleanup);

async function fetchFeedXml(includeAll: boolean): Promise<string> {
  const url = includeAll
    ? 'http://localhost/feed/cyber-wire.rss?include=all'
    : 'http://localhost/feed/cyber-wire.rss';
  const res = await GET(new Request(url));
  expect(res.status).toBe(200);
  return res.text();
}

describe('GET /feed/cyber-wire.rss — canonical AI narrowing', () => {
  it('includes high+AI-relevant alerts', async () => {
    await seedAlert({ severity: 'high', aiRelevance: 0.85, headlineSuffix: 'ai-relevant-high' });
    const xml = await fetchFeedXml(false);
    expect(xml).toContain(`${TEST_MARKER}-ai-relevant-high`);
  });

  it('includes critical alerts regardless of AI-relevance', async () => {
    await seedAlert({ severity: 'critical', aiRelevance: 0.1, headlineSuffix: 'crit-nonai' });
    const xml = await fetchFeedXml(false);
    expect(xml).toContain(`${TEST_MARKER}-crit-nonai`);
  });

  it('excludes high-severity non-AI-relevant alerts', async () => {
    await seedAlert({ severity: 'high', aiRelevance: 0.2, headlineSuffix: 'high-nonai' });
    const xml = await fetchFeedXml(false);
    expect(xml).not.toContain(`${TEST_MARKER}-high-nonai`);
  });

  it('treats unscored (NULL ai_relevance) high as non-AI (excluded)', async () => {
    await seedAlert({ severity: 'high', aiRelevance: null, headlineSuffix: 'high-unscored' });
    const xml = await fetchFeedXml(false);
    expect(xml).not.toContain(`${TEST_MARKER}-high-unscored`);
  });

  it('treats unscored critical as included (severity=critical wins)', async () => {
    await seedAlert({ severity: 'critical', aiRelevance: null, headlineSuffix: 'crit-unscored' });
    const xml = await fetchFeedXml(false);
    expect(xml).toContain(`${TEST_MARKER}-crit-unscored`);
  });
});

describe('GET /feed/cyber-wire.rss?include=all — archive escape hatch', () => {
  it('returns all critical+high alerts regardless of ai_relevance', async () => {
    await seedAlert({ severity: 'critical', aiRelevance: 0.1, headlineSuffix: 'arch-crit' });
    await seedAlert({ severity: 'high', aiRelevance: 0.2, headlineSuffix: 'arch-high' });

    const xml = await fetchFeedXml(true);
    expect(xml).toContain(`${TEST_MARKER}-arch-crit`);
    expect(xml).toContain(`${TEST_MARKER}-arch-high`);
  });
});

describe('GET /feed/cyber-wire.rss — channel metadata reflects AI niche', () => {
  it('channel title and description name the AI-cyber niche', async () => {
    const xml = await fetchFeedXml(false);
    expect(xml).toContain('<title>Cocoa AI · AI Cyber Wire</title>');
    expect(xml).toMatch(/AI-cyber/i);
  });
});

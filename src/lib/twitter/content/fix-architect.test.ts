/**
 * End-to-end test for the fix-architect patch-thread generator. Verifies
 * that a per-CVE remediation thread requires actual remediation rows on
 * record — generic "patch promptly" output is intentionally blocked at
 * the data-assembly layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';
import { DEFAULT_HASHTAG } from './format';

const mockGenerateThread = vi.fn();
vi.mock('./llm', () => ({
  generateThread: (...args: unknown[]) => mockGenerateThread(...args),
}));
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return { ...actual, recordAudit: vi.fn(async () => {}) };
});
vi.mock('@/lib/ws/server', () => ({ broadcast: vi.fn() }));

const { generatePatchThread } = await import('./fix-architect');

const TEST_MARKER = 'test:fix-architect-9.4';
const TEST_CVE = 'CVE-TEST-9-4-9001';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
  await query(`DELETE FROM aegis_remediations WHERE cve_id = $1`, [TEST_CVE]);
  await query(`DELETE FROM aegis_pipeline_alerts WHERE entity_id = $1`, [TEST_CVE]);
  await query(`DELETE FROM aegis_cves WHERE cve_id = $1`, [TEST_CVE]);
}

beforeEach(() => {
  mockGenerateThread.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('generatePatchThread', () => {
  it('returns no_qualifying_items when the CVE has no record', async () => {
    const r = await generatePatchThread({
      cveId: 'CVE-2099-99999',
      createdBy: TEST_MARKER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_qualifying_items');
    expect(mockGenerateThread).not.toHaveBeenCalled();
  });

  it('returns no_qualifying_items when the CVE has no remediations on file', async () => {
    // Seed a CVE row but no remediations — fix-architect refuses to emit
    // a generic-advice thread.
    await query(
      `INSERT INTO aegis_cves (cve_id, published_at, summary, severity)
       VALUES ($1, '2026-05-20', 'test summary', 'high')`,
      [TEST_CVE],
    );

    const r = await generatePatchThread({ cveId: TEST_CVE, createdBy: TEST_MARKER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_qualifying_items');
    expect(r.details).toMatch(/remediations/);
  });

  it('stages a fix_architect draft when remediations are on file', async () => {
    await query(
      `INSERT INTO aegis_cves (cve_id, published_at, summary, severity)
       VALUES ($1, '2026-05-20', 'test summary', 'critical')`,
      [TEST_CVE],
    );
    await query(
      `INSERT INTO aegis_remediations (cve_id, vendor, patch_version, released_at, advisory_url)
       VALUES ($1, 'TestVendor', '4.2.1', '2026-05-23', 'https://example.com/advisory')`,
      [TEST_CVE],
    );

    mockGenerateThread.mockResolvedValueOnce({
      ok: true,
      draft: {
        tweets: [
          { text: `${TEST_CVE} patch playbook ${DEFAULT_HASHTAG}` },
          { text: 'THREAT: brief description' },
          { text: 'STEP 1: upgrade TestVendor to 4.2.1' },
          { text: 'STEP 2: apply MITRE M1051' },
          { text: 'VERIFY 🧵 5/5' },
        ],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      rawJson: '...',
    });

    const r = await generatePatchThread({ cveId: TEST_CVE, createdBy: TEST_MARKER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tweetCount).toBe(5);

    const { rows } = await query<{ draft_type: string; agent_mode: string; headline: string }>(
      `SELECT draft_type, agent_mode, headline FROM aegis_outbound_drafts WHERE id = $1`,
      [r.draftId],
    );
    expect(rows[0]!.draft_type).toBe('patch_thread');
    expect(rows[0]!.agent_mode).toBe('fix_architect');
    expect(rows[0]!.headline).toContain(TEST_CVE);
  });
});

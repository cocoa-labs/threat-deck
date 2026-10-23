/**
 * Tests for the Phase 10.2 deterministic pivot template engine.
 *
 * The template tier is the always-on baseline that runs sub-500ms — no
 * LLM, no I/O, just SQL row → 3 suggestions. These tests pin down:
 *
 *   1. Exactly 3 suggestions per kind when all context fields are present
 *   2. Templates drop gracefully when their context fields are missing
 *   3. No "deep analysis" verbose language (rule #26)
 *   4. Source URL builder routes to the AEGIS HTML viewer namespace
 *
 * The DB-touching `loadEntityRow` is exercised in a separate integration
 * test because it requires a seeded schema. The pure template logic that
 * runs AFTER `loadEntityRow` is what this file tests.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEntitySourceUrl,
  buildTemplatedPivots,
  type CampaignRow,
  type CveRow,
  isPivotKind,
  type PivotSuggestion,
  type ThreatActorRow,
  type VictimRow,
} from './pivot-templates';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const actorComplete: ThreatActorRow = {
  actor_id: 'LockBit',
  display_name: 'LockBit',
  aliases: ['Bitwise Spider'],
  attribution_country: 'RU',
  last_active_at: '2025-05-20T12:00:00Z',
  composite_score: 88,
  actor_grade: 'A',
  top_sector: 'Healthcare',
  peer_actor_display_name: 'BlackCat',
  campaign_count: 12,
  target_count: 47,
};

const actorMinimal: ThreatActorRow = {
  actor_id: 'NewActor',
  display_name: 'NewActor',
  aliases: null,
  attribution_country: null,
  last_active_at: null,
  composite_score: null,
  actor_grade: null,
  top_sector: null,
  peer_actor_display_name: null,
  campaign_count: 0,
  target_count: 0,
};

const cveComplete: CveRow = {
  cve_id: 'CVE-2024-3400',
  cvss_v3_score: 10.0,
  severity: 'critical',
  is_kev: true,
  epss_score: 0.94,
  exploited_in_wild: true,
  primary_vendor: 'Palo Alto Networks',
  primary_product: 'PAN-OS',
};

const cveSparse: CveRow = {
  cve_id: 'CVE-2025-99999',
  cvss_v3_score: 7.5,
  severity: 'high',
  is_kev: false,
  epss_score: null,
  exploited_in_wild: null,
  primary_vendor: null,
  primary_product: null,
};

const victimComplete: VictimRow = {
  id: 42,
  org_name: 'ACME Hospital',
  industry: 'Healthcare',
  country: 'US',
  has_active_ransom: true,
  last_breach_at: '2025-04-01T00:00:00Z',
};

const victimMinimal: VictimRow = {
  id: 99,
  org_name: 'Unknown LLC',
  industry: null,
  country: null,
  has_active_ransom: null,
  last_breach_at: null,
};

const campaignComplete: CampaignRow = {
  id: 7,
  campaign_name: 'Operation Cobalt',
  actor_id: 'LockBit',
  actor_display_name: 'LockBit',
  start_date: '2025-01-15',
  end_date: null,
  primary_target_sector: 'Finance',
};

const campaignNoSector: CampaignRow = {
  id: 8,
  campaign_name: 'Operation Ghost',
  actor_id: 'BlackCat',
  actor_display_name: 'BlackCat',
  start_date: '2025-03-01',
  end_date: null,
  primary_target_sector: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expectsConciseVerbs(suggestions: PivotSuggestion[]): void {
  for (const s of suggestions) {
    expect(s.label).not.toMatch(/deep\s+analysis/i);
    expect(s.label).not.toMatch(/deeply\s+analyze/i);
    expect(s.prefillPrompt).not.toMatch(/deep\s+analysis/i);
    expect(s.label.length).toBeLessThanOrEqual(80); // tolerant of long entity names
    expect(s.prefillPrompt.length).toBeGreaterThan(0);
  }
}

// ─── threat_actor ────────────────────────────────────────────────────────────

describe('buildTemplatedPivots — threat_actor', () => {
  it('returns 3 suggestions when all context fields present', () => {
    const out = buildTemplatedPivots({ kind: 'threat_actor', data: actorComplete });
    expect(out).toHaveLength(3);
    expectsConciseVerbs(out);
  });

  it('drops sector + peer templates when those fields are missing', () => {
    const out = buildTemplatedPivots({ kind: 'threat_actor', data: actorMinimal });
    // Only the unpatched-CVE template should remain
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toContain('NewActor');
    expect(out[0]?.label).toContain('exploited but unpatched');
  });

  it('mentions the top sector in the sector-victims template', () => {
    const out = buildTemplatedPivots({ kind: 'threat_actor', data: actorComplete });
    const sectorPivot = out.find((p) => p.label.includes('Healthcare'));
    expect(sectorPivot).toBeDefined();
    expect(sectorPivot?.prefillPrompt).toContain('Healthcare');
  });

  it('mentions the peer actor in the compare-TTPs template', () => {
    const out = buildTemplatedPivots({ kind: 'threat_actor', data: actorComplete });
    const peerPivot = out.find((p) => p.label.includes('BlackCat'));
    expect(peerPivot).toBeDefined();
    expect(peerPivot?.prefillPrompt).toContain('BlackCat');
    expect(peerPivot?.prefillPrompt).toContain('MITRE ATT&CK');
  });

  it('assigns sequential ranks 0..n', () => {
    const out = buildTemplatedPivots({ kind: 'threat_actor', data: actorComplete });
    expect(out.map((s) => s.rank)).toEqual([0, 1, 2]);
  });
});

// ─── cve ─────────────────────────────────────────────────────────────────────

describe('buildTemplatedPivots — cve', () => {
  it('returns 3 suggestions with full vendor/product context', () => {
    const out = buildTemplatedPivots({ kind: 'cve', data: cveComplete });
    expect(out).toHaveLength(3);
    expectsConciseVerbs(out);
  });

  it('falls back to CVE-id only template when vendor/product unknown', () => {
    const out = buildTemplatedPivots({ kind: 'cve', data: cveSparse });
    expect(out).toHaveLength(3);
    // Third template should mention the CVE id, not a vendor name
    expect(out[2]?.label).toContain('CVE-2025-99999');
    expect(out[2]?.label).not.toContain('Palo Alto');
  });

  it('mentions D3FEND in the defenses template', () => {
    const out = buildTemplatedPivots({ kind: 'cve', data: cveComplete });
    const defPivot = out.find((p) => /defens/i.test(p.label));
    expect(defPivot).toBeDefined();
    expect(defPivot?.prefillPrompt).toMatch(/D3FEND/);
  });

  it('mentions the vendor+product when present', () => {
    const out = buildTemplatedPivots({ kind: 'cve', data: cveComplete });
    const histPivot = out.find((p) => p.label.includes('Palo Alto'));
    expect(histPivot).toBeDefined();
    expect(histPivot?.prefillPrompt).toContain('PAN-OS');
  });
});

// ─── victim ──────────────────────────────────────────────────────────────────

describe('buildTemplatedPivots — victim', () => {
  it('returns 3 suggestions when industry present', () => {
    const out = buildTemplatedPivots({ kind: 'victim', data: victimComplete });
    expect(out).toHaveLength(3);
    expectsConciseVerbs(out);
  });

  it('drops the industry-comps template when industry unknown', () => {
    const out = buildTemplatedPivots({ kind: 'victim', data: victimMinimal });
    expect(out).toHaveLength(2);
    for (const p of out) {
      expect(p.label).not.toMatch(/in\s+null/i);
    }
  });

  it('mentions the org name in the attacker template', () => {
    const out = buildTemplatedPivots({ kind: 'victim', data: victimComplete });
    const attackerPivot = out.find((p) => /who attacked/i.test(p.label));
    expect(attackerPivot).toBeDefined();
    expect(attackerPivot?.label).toContain('ACME Hospital');
  });
});

// ─── campaign ────────────────────────────────────────────────────────────────

describe('buildTemplatedPivots — campaign', () => {
  it('returns 3 suggestions with full sector context', () => {
    const out = buildTemplatedPivots({ kind: 'campaign', data: campaignComplete });
    expect(out).toHaveLength(3);
    expectsConciseVerbs(out);
  });

  it('falls back to sector-agnostic victims template when sector unknown', () => {
    const out = buildTemplatedPivots({ kind: 'campaign', data: campaignNoSector });
    expect(out).toHaveLength(3);
    const victimsPivot = out.find((p) => /victims of/i.test(p.label));
    expect(victimsPivot).toBeDefined();
    // Sector-agnostic version: label does NOT name a sector
    expect(victimsPivot?.label).not.toContain('Finance');
    expect(victimsPivot?.label).not.toContain('Healthcare');
  });

  it('mentions the actor in the next-sector prediction template', () => {
    const out = buildTemplatedPivots({ kind: 'campaign', data: campaignComplete });
    const predPivot = out.find((p) => /predicted next sector/i.test(p.label));
    expect(predPivot).toBeDefined();
    expect(predPivot?.label).toContain('LockBit');
  });
});

// ─── buildEntitySourceUrl ────────────────────────────────────────────────────

describe('buildEntitySourceUrl', () => {
  it('routes threat_actor to /api/aegis/threat-actors/view', () => {
    expect(buildEntitySourceUrl('threat_actor', 'LockBit')).toBe(
      '/api/aegis/threat-actors/view?id=LockBit',
    );
  });

  it('routes cve to /api/aegis/cves/view', () => {
    expect(buildEntitySourceUrl('cve', 'CVE-2024-3400')).toBe(
      '/api/aegis/cves/view?id=CVE-2024-3400',
    );
  });

  it('routes victim to /api/aegis/compromised-orgs/view', () => {
    expect(buildEntitySourceUrl('victim', '42')).toBe('/api/aegis/compromised-orgs/view?id=42');
  });

  it('routes campaign to /api/aegis/incidents/view', () => {
    expect(buildEntitySourceUrl('campaign', '7')).toBe('/api/aegis/incidents/view?id=7');
  });

  it('URL-encodes entity IDs with special characters', () => {
    expect(buildEntitySourceUrl('threat_actor', 'APT 28 / Fancy Bear')).toBe(
      '/api/aegis/threat-actors/view?id=APT%2020%2F%20Fancy%20Bear'.replace('%2020', '%2028%20'),
    );
  });
});

// ─── isPivotKind ─────────────────────────────────────────────────────────────

describe('isPivotKind', () => {
  it('accepts the four supported kinds', () => {
    expect(isPivotKind('threat_actor')).toBe(true);
    expect(isPivotKind('cve')).toBe(true);
    expect(isPivotKind('victim')).toBe(true);
    expect(isPivotKind('campaign')).toBe(true);
  });

  it('rejects unsupported kinds + non-strings', () => {
    expect(isPivotKind('matrix_cell')).toBe(false);
    expect(isPivotKind('sankey_flow')).toBe(false);
    expect(isPivotKind(null)).toBe(false);
    expect(isPivotKind(42)).toBe(false);
    expect(isPivotKind(undefined)).toBe(false);
    expect(isPivotKind('')).toBe(false);
  });
});

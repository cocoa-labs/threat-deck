/**
 * Drift guard for the toast → agent hand-off.
 *
 * `buildPrefill` early-returns a bare prompt for any trigger missing from
 * `TRIGGER_CONTEXT_MAP`, throwing away `eventData`. When only `news.breaking`
 * and `monitor.keyword_match` were mapped, clicking a KEV / breach / patch
 * toast handed Max a truncated sentence with no CVE id and no source — exactly
 * the triggers that matter most in a cybersecurity product.
 *
 * These tests assert the map covers every registered trigger, and that the
 * `<context>` block actually survives into the prompt.
 */

import { describe, expect, it } from 'vitest';
import { EVENT_TRIGGERS } from '@/lib/agent/activation';
import type { AutonomousResultItem } from '@/lib/store/agent-store';
import { buildPrefill, TRIGGER_CONTEXT_MAP } from './AgentToast';

function result(overrides: Partial<AutonomousResultItem> = {}): AutonomousResultItem {
  return {
    id: 'auto-1',
    triggerSource: 'cve.kev_added',
    task: 'KEV added',
    headline: 'KEV: PAN-OS command injection',
    severity: 'critical',
    text: 'BLUF: CISA added CVE-2024-3400 to the KEV catalogue.',
    timestamp: Date.now(),
    dismissed: false,
    eventData: { cve_id: 'CVE-2024-3400', vendor_project: 'Palo Alto' },
    ...overrides,
  } as AutonomousResultItem;
}

describe('TRIGGER_CONTEXT_MAP', () => {
  it('covers every registered activation trigger', () => {
    const unmapped = Object.keys(EVENT_TRIGGERS).filter((key) => !TRIGGER_CONTEXT_MAP[key]);
    expect(
      unmapped,
      `unmapped triggers drop eventData on toast click: ${unmapped.join(', ')}`,
    ).toEqual([]);
  });

  it('routes each cyber trigger at its own panel', () => {
    expect(TRIGGER_CONTEXT_MAP['cve.kev_added']?.sourcePanel).toBe('kevAlerts');
    expect(TRIGGER_CONTEXT_MAP['breach.disclosed']?.sourcePanel).toBe('breachDisclosure');
    expect(TRIGGER_CONTEXT_MAP['patch.released']?.sourcePanel).toBe('patchTracker');
  });
});

describe('buildPrefill', () => {
  it('embeds a parseable <context> block carrying the event data', () => {
    const prompt = buildPrefill(result());
    const match = prompt.match(/<context>([\s\S]*)<\/context>/);
    expect(match).not.toBeNull();

    const context = JSON.parse(match?.[1] ?? '{}');
    expect(context.sourcePanel).toBe('kevAlerts');
    expect(context.dataType).toBe('kev');
    expect(context.trendData.cve_id).toBe('CVE-2024-3400');
    expect(typeof context.timestamp).toBe('string');
  });

  it('produces a context block for every registered trigger', () => {
    for (const triggerSource of Object.keys(EVENT_TRIGGERS)) {
      const prompt = buildPrefill(result({ triggerSource }));
      expect(prompt, triggerSource).toContain('<context>');
    }
  });

  it('falls back to a bare prompt when the run carried no event data', () => {
    const prompt = buildPrefill(result({ eventData: undefined }));
    expect(prompt).not.toContain('<context>');
    expect(prompt).toContain('Follow up on this autonomous analysis');
  });
});

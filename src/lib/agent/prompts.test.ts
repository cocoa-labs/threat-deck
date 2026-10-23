/**
 * Tests for buildSystemPrompt's three-mode posture wiring (Phase 14 + 14.5).
 *
 * Phase 14:    The base prompt always instructs the model to emit a [[MODE:...]]
 *              marker as the first line of its response.
 * Phase 14.5:  The mode-LOCK addendum was moved OUT of the prompt-cached
 *              `staticBlock` and INTO the per-call `dynamicBlock` to preserve
 *              Anthropic prompt-cache hit rate (CLAUDE.md Rule #7). The marker-
 *              emit instruction stays in `staticBlock` (it's stable across calls).
 */

import { describe, expect, it } from 'vitest';
import type { AgentContext } from '@/lib/types';
import { buildSystemPrompt } from './prompts';
import { buildSessionMediaManifest, sanitizeSessionMedia } from './session-media';
import type { MemoryState } from './types';

const emptyContext: AgentContext = {
  marketStatus: 'closed',
  activeAlerts: [],
  pendingApprovals: [],
  recentBriefs: [],
  user: { id: 'u', focusAreas: [], preferences: {} },
};

const emptyMemory: MemoryState = {
  rollingSummary: '',
  recentExchanges: [],
  persistedMemories: [],
};

describe('buildSystemPrompt — three-mode posture', () => {
  describe('mode marker emission instruction (stable, lives in staticBlock)', () => {
    it('instructs the model to emit [[MODE:...]] when no lock is set', () => {
      const { staticBlock } = buildSystemPrompt(emptyContext, emptyMemory);
      expect(staticBlock).toContain('[[MODE:anchor]]');
      expect(staticBlock).toContain('[[MODE:analyst]]');
      expect(staticBlock).toContain('[[MODE:fix-architect]]');
    });

    it('keeps the [[MODE:...]] instruction in staticBlock even when a lock is set (cache-key stable)', () => {
      const { staticBlock } = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'analyst',
      );
      expect(staticBlock).toContain('[[MODE:anchor]]');
      expect(staticBlock).toContain('[[MODE:analyst]]');
      expect(staticBlock).toContain('[[MODE:fix-architect]]');
    });
  });

  describe('Phase 14.5 — prompt-cache stability (Rule #7)', () => {
    it('staticBlock is byte-identical across different lock states (no cache-key fragmentation)', () => {
      // The mode-lock addendum belongs in dynamicBlock, not staticBlock —
      // otherwise every lock toggle creates a new Anthropic prompt-cache key
      // for the full ~50KB static payload. See CLAUDE.md Rule #7.
      const auto = buildSystemPrompt(emptyContext, emptyMemory).staticBlock;
      const anchor = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'anchor',
      ).staticBlock;
      const analyst = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'analyst',
      ).staticBlock;
      const fixArch = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'fix-architect',
      ).staticBlock;
      expect(anchor).toBe(auto);
      expect(analyst).toBe(auto);
      expect(fixArch).toBe(auto);
    });
  });

  describe('when effectiveMode is null/undefined (AUTO)', () => {
    it('does NOT include the MODE LOCKED addendum heading in either block', () => {
      const { staticBlock, dynamicBlock } = buildSystemPrompt(emptyContext, emptyMemory);
      for (const block of [staticBlock, dynamicBlock]) {
        expect(block).not.toContain('# MODE LOCKED — ANCHOR');
        expect(block).not.toContain('# MODE LOCKED — ANALYST');
        expect(block).not.toContain('# MODE LOCKED — FIX ARCHITECT');
      }
    });
  });

  describe('when effectiveMode is locked to anchor', () => {
    it('appends the ANCHOR lock addendum to the DYNAMIC block (not static)', () => {
      const { staticBlock, dynamicBlock } = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'anchor',
      );
      expect(dynamicBlock).toContain('# MODE LOCKED — ANCHOR');
      expect(staticBlock).not.toContain('# MODE LOCKED — ANCHOR');
    });
  });

  describe('when effectiveMode is locked to analyst', () => {
    it('appends the ANALYST lock addendum to the DYNAMIC block', () => {
      const { staticBlock, dynamicBlock } = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'analyst',
      );
      expect(dynamicBlock).toContain('# MODE LOCKED — ANALYST');
      expect(staticBlock).not.toContain('# MODE LOCKED — ANALYST');
    });
  });

  describe('when effectiveMode is locked to fix-architect', () => {
    it('appends the FIX ARCHITECT lock addendum to the DYNAMIC block', () => {
      const { staticBlock, dynamicBlock } = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'fix-architect',
      );
      expect(dynamicBlock).toContain('# MODE LOCKED — FIX ARCHITECT');
      expect(staticBlock).not.toContain('# MODE LOCKED — FIX ARCHITECT');
    });

    it('does NOT also include unrelated mode addenda', () => {
      const { dynamicBlock } = buildSystemPrompt(
        emptyContext,
        emptyMemory,
        'standard',
        undefined,
        'fix-architect',
      );
      expect(dynamicBlock).not.toContain('# MODE LOCKED — ANCHOR');
      expect(dynamicBlock).not.toContain('# MODE LOCKED — ANALYST');
    });
  });
});

describe('buildSystemPrompt — session-generated media manifest', () => {
  const contextWithMedia: AgentContext = {
    ...emptyContext,
    sessionMedia: [
      {
        generatedMediaId: '88',
        kind: 'image',
        styleTag: 'research_gap_card',
        status: 'ready',
        createdAt: Date.now() - 60_000,
      },
      {
        generatedMediaId: '42',
        kind: 'video',
        styleTag: 'cinematic_recap',
        status: 'pending',
        createdAt: Date.now() - 3_600_000,
      },
    ],
  };

  it('omits the section entirely when there is no session media (no hallucinated media)', () => {
    const { dynamicBlock } = buildSystemPrompt(emptyContext, emptyMemory);
    expect(dynamicBlock).not.toContain('## Session-Generated Media');
  });

  it('surfaces id, kind, humanized styleTag, and status for awareness (no tool wiring)', () => {
    const { dynamicBlock } = buildSystemPrompt(contextWithMedia, emptyMemory);
    expect(dynamicBlock).toContain('## Session-Generated Media');
    expect(dynamicBlock).toContain('#88');
    expect(dynamicBlock).toContain('image');
    expect(dynamicBlock).toContain('research gap card'); // underscores humanized
    expect(dynamicBlock).toContain('[READY]');
    expect(dynamicBlock).toContain('[PENDING]');
    // Awareness layer must NOT hardcode email/X tool param shapes — that lives in
    // the tool sections (and is being reworked separately). Keep this decoupled.
    expect(dynamicBlock).not.toContain('attachMediaIds');
    expect(dynamicBlock).not.toContain('email_conversation');
  });

  it('preserves the given (newest-first) order in the rendered list', () => {
    const { dynamicBlock } = buildSystemPrompt(contextWithMedia, emptyMemory);
    expect(dynamicBlock.indexOf('#88')).toBeLessThan(dynamicBlock.indexOf('#42'));
  });

  it('keeps the section out of the prompt-cached staticBlock (Rule #7 — byte-identical)', () => {
    const without = buildSystemPrompt(emptyContext, emptyMemory).staticBlock;
    const withMedia = buildSystemPrompt(contextWithMedia, emptyMemory).staticBlock;
    expect(withMedia).toBe(without);
    expect(withMedia).not.toContain('## Session-Generated Media');
  });

  it('threads a button-created image through the full chain (store → builder → wire → sanitizer → prompt)', () => {
    // Simulates the exact production path: a message carrying an IMG-button-created
    // image (no agent tool call) reaches Max's context so it is AWARE of the media.
    const storeMessages = [
      {
        generatedImages: [
          {
            generatedMediaId: '55',
            blobUrl: 'https://blob/55.png',
            styleTag: 'research_gap_card',
            status: 'ready' as const,
            createdAt: Date.now() - 30_000,
          },
        ],
      },
    ];
    const manifest = buildSessionMediaManifest(storeMessages);
    const overWire = JSON.parse(JSON.stringify(manifest)) as unknown; // POST round-trip
    const clean = sanitizeSessionMedia(overWire);
    const { dynamicBlock } = buildSystemPrompt(
      { ...emptyContext, sessionMedia: clean },
      emptyMemory,
    );
    expect(dynamicBlock).toContain('## Session-Generated Media');
    expect(dynamicBlock).toContain('#55');
    expect(dynamicBlock).toContain('research gap card');
    expect(dynamicBlock).toContain('[READY]');
  });
});

/**
 * Tests for the three-mode posture state added to the agent store in Phase 14:
 *   - lockedMode (null = AUTO, or one of AgentMode)
 *   - detectedMode (mode the latest response used; defaults to 'anchor')
 *   - setLockedMode / setDetectedMode actions
 *   - ConversationMessage.agentMode field
 *
 * Implementation note: this project's jsdom-based test env exposes
 * `localStorage` as a stub whose methods aren't callable, which trips up
 * Zustand v5's persist middleware at module-import time. We stub a
 * working in-memory localStorage BEFORE importing the store (via dynamic
 * import) so persist hydration succeeds.
 *
 * The persist-middleware migration shim is verified by manual smoke (see plan
 * §Verification step "Persist migration").
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { useAgentStore as UseAgentStore } from './agent-store';

describe('agent-store — three-mode posture state', () => {
  let useAgentStore: typeof UseAgentStore;

  beforeAll(async () => {
    const memoryStore = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memoryStore.set(key, value);
      },
      removeItem: (key: string) => {
        memoryStore.delete(key);
      },
      clear: () => {
        memoryStore.clear();
      },
      key: (i: number) => Array.from(memoryStore.keys())[i] ?? null,
      get length() {
        return memoryStore.size;
      },
    });

    ({ useAgentStore } = await import('./agent-store'));
  });

  describe('setLockedMode', () => {
    it('locks to analyst', () => {
      useAgentStore.getState().setLockedMode('analyst');
      expect(useAgentStore.getState().lockedMode).toBe('analyst');
    });

    it('locks to fix-architect', () => {
      useAgentStore.getState().setLockedMode('fix-architect');
      expect(useAgentStore.getState().lockedMode).toBe('fix-architect');
    });

    it('locks to anchor (explicit lock floor)', () => {
      useAgentStore.getState().setLockedMode('anchor');
      expect(useAgentStore.getState().lockedMode).toBe('anchor');
    });

    it('null unlocks to AUTO', () => {
      useAgentStore.getState().setLockedMode('analyst');
      useAgentStore.getState().setLockedMode(null);
      expect(useAgentStore.getState().lockedMode).toBeNull();
    });
  });

  describe('setDetectedMode', () => {
    it('records the mode the latest response used', () => {
      useAgentStore.getState().setDetectedMode('fix-architect');
      expect(useAgentStore.getState().detectedMode).toBe('fix-architect');
    });

    it('overwrites previous detected mode (stream-by-stream)', () => {
      useAgentStore.getState().setDetectedMode('analyst');
      useAgentStore.getState().setDetectedMode('anchor');
      expect(useAgentStore.getState().detectedMode).toBe('anchor');
    });
  });

  describe('ConversationMessage.agentMode', () => {
    it('addMessage carries the agentMode field through to the persisted message', () => {
      useAgentStore.getState().clearConversation();
      useAgentStore.getState().addMessage({
        role: 'assistant',
        content: 'test response',
        timestamp: Date.now(),
        agentMode: 'analyst',
      });

      const messages = useAgentStore.getState().messages;
      const last = messages[messages.length - 1];
      expect(last?.agentMode).toBe('analyst');
    });

    it('addMessage tolerates a message without agentMode (graceful pre-rollout migration)', () => {
      useAgentStore.getState().clearConversation();
      useAgentStore.getState().addMessage({
        role: 'user',
        content: 'pre-rollout message',
        timestamp: Date.now(),
      });

      const messages = useAgentStore.getState().messages;
      const last = messages[messages.length - 1];
      expect(last?.agentMode).toBeUndefined();
    });
  });
});

describe('agent-store — drawer fullscreen preservation', () => {
  let useAgentStore: typeof UseAgentStore;

  beforeAll(async () => {
    // Module is cached from the prior describe; this re-import returns the
    // same singleton. The localStorage stub remains effective from that block.
    ({ useAgentStore } = await import('./agent-store'));
  });

  it('addToHistory preserves drawerFullscreen when in active conversation', () => {
    useAgentStore.getState().setDrawerFullscreen(true);
    useAgentStore.getState().addToHistory('hello max');
    expect(useAgentStore.getState().drawerFullscreen).toBe(true);
  });

  it('setPrefill preserves drawerFullscreen when in active conversation', () => {
    useAgentStore.getState().setDrawerFullscreen(true);
    useAgentStore.getState().setPrefill('analyze this');
    expect(useAgentStore.getState().drawerFullscreen).toBe(true);
  });

  it('setDrawerOpen(false) still resets drawerFullscreen — explicit close clears it', () => {
    useAgentStore.getState().setDrawerFullscreen(true);
    useAgentStore.getState().setDrawerOpen(false);
    expect(useAgentStore.getState().drawerFullscreen).toBe(false);
  });

  it('setDrawerOpen(true) resets drawerFullscreen — defaults to non-fullscreen on open', () => {
    useAgentStore.getState().setDrawerFullscreen(true);
    useAgentStore.getState().setDrawerOpen(true);
    expect(useAgentStore.getState().drawerFullscreen).toBe(false);
  });
});

// Phase 14.5 hardening — code-review finding #1
// Persist version bump from v0 → v1 must NOT wipe a returning user's data.
// This describe owns its own localStorage stub + module re-import so the
// hydration step picks up the pre-populated v0 payload.
describe('agent-store — v0 → v1 persist migration', () => {
  it('discards legacy unscoped sensitive data on upgrade', async () => {
    const v0Payload = {
      state: {
        conversations: [
          {
            id: 'conv-old',
            query: 'hi',
            toolCalls: [],
            response: null,
            status: 'completed',
            startedAt: 1,
            completedAt: 2,
          },
        ],
        commandHistory: ['hello max'],
        messages: [
          { role: 'user', content: 'hi', timestamp: 1, origin: 'agent' },
          { role: 'assistant', content: 'hi back', timestamp: 2, origin: 'agent' },
        ],
        recentBriefs: [],
        activeAttachments: [],
        // No lockedMode — the whole point of the v0 → v1 boundary.
      },
      version: 0,
    };

    const memoryStore = new Map<string, string>();
    memoryStore.set('threatdeck-agent', JSON.stringify(v0Payload));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memoryStore.set(key, value);
      },
      removeItem: (key: string) => {
        memoryStore.delete(key);
      },
      clear: () => {
        memoryStore.clear();
      },
      key: (i: number) => Array.from(memoryStore.keys())[i] ?? null,
      get length() {
        return memoryStore.size;
      },
    });

    vi.resetModules();
    const { useAgentStore: freshStore } = await import('./agent-store');

    // Allow one microtask for persist hydration to complete.
    await new Promise((r) => setTimeout(r, 0));

    const state = freshStore.getState();
    expect(state.conversations).toEqual([]);
    expect(state.commandHistory).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(memoryStore.get('threatdeck-agent')).not.toContain('hi back');
    // Missing-from-v0 lockedMode defaults to AUTO.
    expect(state.lockedMode).toBeNull();
    // detectedMode is intentionally NOT persisted — resets to 'anchor' each session.
    expect(state.detectedMode).toBe('anchor');
  });
});

// Phase 14 — background "Post to X" toast: dismissing only hides the notification
// (it never cancels the post), and a terminal outcome re-surfaces the toast so the
// user always gets confirmation the tweet went out. Owns its own stub + reset.
describe('agent-store — X-post job toasts (dismiss + terminal re-surface)', () => {
  let useAgentStore: typeof UseAgentStore;
  let isTerminalXPostStatus: typeof import('./agent-store').isTerminalXPostStatus;

  beforeAll(async () => {
    const memoryStore = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memoryStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memoryStore.set(key, value);
      },
      removeItem: (key: string) => {
        memoryStore.delete(key);
      },
      clear: () => {
        memoryStore.clear();
      },
      key: (i: number) => Array.from(memoryStore.keys())[i] ?? null,
      get length() {
        return memoryStore.size;
      },
    });
    vi.resetModules();
    ({ useAgentStore, isTerminalXPostStatus } = await import('./agent-store'));
  });

  const baseJob = {
    jobToken: 'xpost-base',
    status: 'posting' as const,
    pollUrl: '/api/outbound/x/jobs/xpost-base',
    publishMode: 'two_post' as const,
    primaryTextPreview: 'WP Maps Pro is being actively exploited…',
    tweetIds: [] as string[],
    errorCode: null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1,
    dismissed: false,
  };

  describe('isTerminalXPostStatus', () => {
    it('is true only for posted / failed / needs_reconnect', () => {
      expect(isTerminalXPostStatus('posted')).toBe(true);
      expect(isTerminalXPostStatus('failed')).toBe(true);
      expect(isTerminalXPostStatus('needs_reconnect')).toBe(true);
      expect(isTerminalXPostStatus('queued')).toBe(false);
      expect(isTerminalXPostStatus('generating_image')).toBe(false);
      expect(isTerminalXPostStatus('posting')).toBe(false);
    });
  });

  it('updateXPostJob to a TERMINAL status re-surfaces a dismissed toast (clears dismissed)', () => {
    const jobToken = 'xpost-terminal';
    useAgentStore.getState().addXPostJob({ ...baseJob, jobToken, status: 'posting' });
    useAgentStore.getState().dismissXPostJob(jobToken);
    expect(useAgentStore.getState().xPostJobs.find((j) => j.jobToken === jobToken)?.dismissed).toBe(
      true,
    );

    useAgentStore.getState().updateXPostJob(jobToken, { status: 'posted', tweetIds: ['1'] });

    const job = useAgentStore.getState().xPostJobs.find((j) => j.jobToken === jobToken);
    expect(job?.status).toBe('posted');
    expect(job?.dismissed).toBe(false); // re-surfaces so the user sees "Posted ✓"
  });

  it('updateXPostJob to a NON-terminal status leaves a dismissed toast hidden', () => {
    const jobToken = 'xpost-active';
    useAgentStore.getState().addXPostJob({ ...baseJob, jobToken, status: 'queued' });
    useAgentStore.getState().dismissXPostJob(jobToken);

    useAgentStore.getState().updateXPostJob(jobToken, { status: 'posting' });

    const job = useAgentStore.getState().xPostJobs.find((j) => j.jobToken === jobToken);
    expect(job?.status).toBe('posting');
    expect(job?.dismissed).toBe(true); // stays hidden while still in-flight
  });

  it('dismissXPostJob never cancels — it only flips the dismissed flag, status untouched', () => {
    const jobToken = 'xpost-dismiss';
    useAgentStore.getState().addXPostJob({ ...baseJob, jobToken, status: 'posting' });
    useAgentStore.getState().dismissXPostJob(jobToken);
    const job = useAgentStore.getState().xPostJobs.find((j) => j.jobToken === jobToken);
    expect(job?.status).toBe('posting');
    expect(job?.dismissed).toBe(true);
  });

  it('addXPostJob round-trips messageTimestamp so a generate-image post can seed its image inline', () => {
    const jobToken = 'xpost-msglink';
    useAgentStore
      .getState()
      .addXPostJob({ ...baseJob, jobToken, messageTimestamp: 1_779_000_000_000 });
    const job = useAgentStore.getState().xPostJobs.find((j) => j.jobToken === jobToken);
    expect(job?.messageTimestamp).toBe(1_779_000_000_000);
  });
});

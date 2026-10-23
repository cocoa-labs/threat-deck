/**
 * Tests for the ToolRegistry approval gate.
 *
 * The gate used to return `{ requires_approval: true, message: 'This action
 * requires human approval before execution.' }` — an object produced here and
 * consumed by nothing. No approval row was written, no operator was prompted,
 * and the model simply read the blob and reported the action as queued. Two
 * tools sat behind it doing nothing at all.
 *
 * It now fails loud. These tests lock that in, and assert that no shipped tool
 * relies on the flag.
 */

import { describe, expect, it } from 'vitest';
import { ToolRegistry } from './tool-registry';
import { registerAllTools } from './tools';
import { ToolCategory } from './types';

const GATED_TOOL = 'test_gated_tool_never_shipped';

describe('approval gate', () => {
  it('refuses to execute a requiresApproval tool and never calls its handler', async () => {
    let handlerRan = false;
    ToolRegistry.register({
      name: GATED_TOOL,
      description: 'test fixture',
      inputSchema: { type: 'object' as const, properties: {}, required: [] },
      handler: async () => {
        handlerRan = true;
        return { created: true };
      },
      tokenBudget: 100,
      category: ToolCategory.ACTION,
      requiresApproval: true,
      cooldownSeconds: 0,
    });

    const result = (await ToolRegistry.execute(GATED_TOOL, {})) as { error?: string };

    expect(handlerRan).toBe(false);
    expect(result.error).toBeTruthy();
    // The model must not be able to read this as "queued for approval".
    expect(result.error).toContain('no approval queue is wired');
    expect(result.error).toContain('nothing was queued');
    expect(result).not.toHaveProperty('requires_approval');
  });

  it('does not permit the legacy method to bypass approval', async () => {
    const result = (await ToolRegistry.executeBypassApproval(GATED_TOOL, {})) as {
      created?: boolean;
    };
    expect(result.created).toBeUndefined();
    expect(result).toHaveProperty('error');
  });
});

describe('shipped tool registry', () => {
  it('has no tool depending on the inert requiresApproval flag', () => {
    registerAllTools();
    const gated = ToolRegistry.getAllTools()
      .map((t) => t.name)
      .filter((name) => name !== GATED_TOOL)
      .filter((name) => ToolRegistry.getToolByName(name)?.requiresApproval);

    expect(
      gated,
      `these tools would silently no-op: ${gated.join(', ')}. Stage into the outbound drafts queue instead (see post_to_x).`,
    ).toEqual([]);
  });

  it('no longer registers the three stub tools that reported fake success', () => {
    registerAllTools();
    const names = ToolRegistry.getAllTools().map((t) => t.name);
    expect(names).not.toContain('create_alert_rule');
    expect(names).not.toContain('publish_brief');
    expect(names).not.toContain('escalate_to_human');
  });

  it('registers the real watchlist tools that replaced them', () => {
    registerAllTools();
    const names = ToolRegistry.getAllTools().map((t) => t.name);
    expect(names).toContain('create_monitor');
    expect(names).toContain('list_monitors');
  });
});

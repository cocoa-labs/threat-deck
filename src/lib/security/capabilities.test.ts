import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '@/lib/agent/tool-registry';
import { ToolCategory } from '@/lib/agent/types';
import { CAPABILITY_FLAGS, capabilityStatus, requireCapability } from './capabilities';

afterEach(() => vi.unstubAllEnvs());
describe('capability enforcement', () => {
  it('defaults every optional service to disabled even when credentials exist', () => {
    for (const flag of Object.values(CAPABILITY_FLAGS)) vi.stubEnv(flag, undefined);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only');
    expect(Object.values(capabilityStatus()).every((value) => !value)).toBe(true);
    expect(() => requireCapability('ai')).toThrow('capability_disabled:ai');
  });
  it('blocks direct execution of a disabled tool and the old approval bypass', async () => {
    const handler = vi.fn(async () => ({ sent: true }));
    ToolRegistry.register({
      name: 'release_disabled',
      description: 'fixture',
      category: ToolCategory.ACTION,
      requiresApproval: false,
      cooldownSeconds: 0,
      tokenBudget: 100,
      featureFlag: 'TEST_TOOL_ENABLED',
      inputSchema: { type: 'object', properties: {} },
      handler,
    });
    vi.stubEnv('TEST_TOOL_ENABLED', undefined);
    expect(await ToolRegistry.execute('release_disabled', {})).toEqual({ error: 'tool_disabled' });
    expect(await ToolRegistry.executeBypassApproval('release_disabled', {})).toEqual({
      error: 'tool_disabled',
    });
    expect(handler).not.toHaveBeenCalled();
  });
  it('validates inputs and never trusts an agent-supplied operator identity', async () => {
    const handler = vi.fn(async (input: Record<string, unknown>) => input);
    ToolRegistry.register({
      name: 'release_input',
      description: 'fixture',
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 0,
      tokenBudget: 100,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'integer', minimum: 1 } },
        required: ['id'],
      },
      handler,
    });
    expect(await ToolRegistry.execute('release_input', { id: '1' })).toEqual({
      error: 'invalid_tool_input',
    });
    expect(
      await ToolRegistry.execute('release_input', { id: 1, operatorEmail: 'attacker@example.org' }),
    ).toMatchObject({ operatorEmail: null });
    expect(
      await ToolRegistry.execute(
        'release_input',
        { id: 1, operatorEmail: 'attacker@example.org' },
        { operatorEmail: 'owner@example.org' },
      ),
    ).toMatchObject({ operatorEmail: 'owner@example.org' });
  });
});

it('preserves side-effect markers when labeling synthetic tool evidence', async () => {
  ToolRegistry.register({
    name: 'release_demo_marker',
    description: 'fixture',
    category: ToolCategory.DATA_RETRIEVAL,
    requiresApproval: false,
    cooldownSeconds: 0,
    tokenBudget: 100,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ __map_command: { type: 'test' }, isFallback: true }),
  });
  expect(await ToolRegistry.execute('release_demo_marker', {})).toMatchObject({
    __map_command: { type: 'test' },
    provenance: 'demo',
  });
});

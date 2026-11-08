import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prism } from '../dist/index.js';
import { tools } from '../agent/agent.mjs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('agent paid authority', () => {
  it.each(['explain', 'consensus'] as const)('%s refuses before reaching a provider builder', async name => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-test-key');
    const provider = vi.spyOn(Prism, 'text').mockImplementation(() => {
      throw new Error('BILLABLE_BUILDER_REACHED');
    });
    const input = {
      subject: 'Owned failure fixture', question: 'Owned question fixture',
      approved: true, owner: 'Wish', run_id: 'caller-supplied-run',
      authority: { approved: true, cap: 5 },
    };
    await expect(tools[name].handler(input)).rejects.toMatchObject({ code: 'paid_call_not_authorised' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not advertise paid readiness merely because a key is present', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-test-key');
    expect(await tools.status.handler()).toMatchObject({
      can_reason: false,
      provider_key_present: true,
      paid_call_refusal: 'paid_call_not_authorised',
    });
  });

  it('keeps free source discovery and the existing tool vocabulary available', async () => {
    const described = await tools.describe_port.handler();
    expect(described.providers_implemented).toContain('anthropic');
    expect(described.provider_operations).toContain('text');
    expect(Object.keys(tools).sort()).toEqual([
      'consensus', 'describe_port', 'ecosystem_probe', 'explain',
      'harness_probe', 'run_conformance', 'run_tests', 'status',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AssistantMessage,
  Prism,
  PrismError,
  ProviderTool,
  Tool,
  ToolCall,
  ToolChoice,
  UserMessage,
  buildRequestBody,
  canonicalJson,
} from '../src/index.js';
import type { TextPendingRequest } from '../src/index.js';

const body = (build: (pending: TextPendingRequest) => TextPendingRequest): string =>
  canonicalJson(buildRequestBody(build(Prism.text().using('openai', 'gpt-4o')).toRequest()));

describe('buildRequestBody', () => {
  it('emits max_output_tokens as an explicit null when it was never set', () => {
    expect(body((p) => p.withPrompt('Who are you?'))).toBe(
      '{"model":"gpt-4o","input":[{"role":"user","content":[{"type":"input_text","text":"Who are you?"}]}],"max_output_tokens":null}',
    );
  });

  it('carries max_output_tokens as an integer when it was set', () => {
    expect(body((p) => p.withPrompt('hi').withMaxTokens(256))).toContain('"max_output_tokens":256');
  });

  it('sends temperature 0, because the filter is on null and not on falsiness', () => {
    expect(body((p) => p.withPrompt('hi').usingTemperature(0))).toContain('"temperature":0');
  });

  it('drops temperature when it was never set', () => {
    expect(body((p) => p.withPrompt('hi'))).not.toContain('temperature');
  });

  it('renames topP to top_p on the wire', () => {
    expect(body((p) => p.withPrompt('hi').usingTopP(0.9))).toContain('"top_p":0.9');
  });

  it('omits the tools key entirely when the tool list is empty', () => {
    // An empty array is TRUTHY in JavaScript. Sending "tools":[] is rejected by
    // some models and silently changes tool_choice defaults on others.
    expect(body((p) => p.withPrompt('hi').withTools([]))).not.toContain('tools');
  });

  it('builds the JSON Schema fragment with description before type', () => {
    const tool = new Tool().as('weather').for('Get the weather').withStringParameter('city', 'The city');

    expect(body((p) => p.withPrompt('hi').withTools([tool]))).toContain(
      '"tools":[{"type":"function","name":"weather","description":"Get the weather","parameters":{"type":"object","properties":{"city":{"description":"The city","type":"string"}},"required":["city"]}}]',
    );
  });

  it('omits parameters and strict for a tool that has neither', () => {
    const tool = new Tool().as('ping').for('Ping');

    expect(body((p) => p.withPrompt('hi').withTools([tool]))).toContain(
      '"tools":[{"type":"function","name":"ping","description":"Ping"}]',
    );
  });

  it('drops strict:false but keeps store:false — the filters disagree on purpose', () => {
    const strictOff = new Tool().as('ping').for('Ping').withProviderOptions({ strict: false });
    const strictOn = new Tool().as('ping').for('Ping').withProviderOptions({ strict: true });

    expect(body((p) => p.withPrompt('hi').withTools([strictOff]))).not.toContain('strict');
    expect(body((p) => p.withPrompt('hi').withTools([strictOn]))).toContain('"strict":true');
    expect(body((p) => p.withPrompt('hi').withProviderOptions({ store: false }))).toContain('"store":false');
  });

  it('preserves tool declaration order', () => {
    const tools = [new Tool().as('zebra').for('Z'), new Tool().as('alpha').for('A')];

    expect(body((p) => p.withPrompt('hi').withTools(tools))).toContain(
      '"tools":[{"type":"function","name":"zebra","description":"Z"},{"type":"function","name":"alpha","description":"A"}]',
    );
  });

  it('merges provider tools in FRONT of the caller tools', () => {
    const tools = [new Tool().as('ping').for('Ping')];
    const providerTools = [new ProviderTool('web_search_preview')];

    expect(body((p) => p.withPrompt('hi').withTools(tools).withProviderTools(providerTools))).toContain(
      '"tools":[{"type":"web_search_preview"},{"type":"function","name":"ping","description":"Ping"}]',
    );
  });

  it('maps tool choices: Auto to a string, Any to "required", a name to an object', () => {
    const tools = [new Tool().as('ping').for('Ping')];

    expect(body((p) => p.withPrompt('hi').withTools(tools).withToolChoice(ToolChoice.Auto))).toContain(
      '"tool_choice":"auto"',
    );
    expect(body((p) => p.withPrompt('hi').withTools(tools).withToolChoice(ToolChoice.Any))).toContain(
      '"tool_choice":"required"',
    );
    expect(body((p) => p.withPrompt('hi').withTools(tools).withToolChoice(ToolChoice.None))).toContain(
      '"tool_choice":"none"',
    );
    expect(body((p) => p.withPrompt('hi').withTools(tools).withToolChoice('ping'))).toContain(
      '"tool_choice":{"type":"function","name":"ping"}',
    );
  });

  it('accepts a Tool as the tool choice and uses its name', () => {
    const tool = new Tool().as('ping').for('Ping');

    expect(body((p) => p.withPrompt('hi').withTools([tool]).withToolChoice(tool))).toContain(
      '"tool_choice":{"type":"function","name":"ping"}',
    );
  });

  it('asks for minimal effort when reasoning is disabled and emits nothing when enabled', () => {
    expect(body((p) => p.withPrompt('hi').withReasoning(false))).toContain('"reasoning":{"effort":"minimal"}');
    expect(body((p) => p.withPrompt('hi').withReasoning(true))).not.toContain('reasoning');
  });

  it('lets an explicit reasoning provider option win over the toggle', () => {
    expect(body((p) => p.withPrompt('hi').withReasoning(false).withProviderOptions({ reasoning: { effort: 'high' } }))).toContain(
      '"reasoning":{"effort":"high"}',
    );
  });

  it('keeps provider options in their declared wire order', () => {
    expect(body((p) => p.withPrompt('hi').withProviderOptions({ store: false, service_tier: 'flex' }))).toBe(
      '{"model":"gpt-4o","input":[{"role":"user","content":[{"type":"input_text","text":"hi"}]}],"max_output_tokens":null,"service_tier":"flex","store":false}',
    );
  });

  it('replaces the prompt path entirely when messages are given', () => {
    const messages = [new UserMessage('What is 2+2?'), new AssistantMessage('4'), new UserMessage('And 3+3?')];

    expect(body((p) => p.withMessages(messages))).toBe(
      '{"model":"gpt-4o","input":[{"role":"user","content":[{"type":"input_text","text":"What is 2+2?"}]},{"role":"assistant","content":[{"type":"output_text","text":"4"}]},{"role":"user","content":[{"type":"input_text","text":"And 3+3?"}]}],"max_output_tokens":null}',
    );
  });

  it('re-encodes a reconstructed tool call with string arguments', () => {
    const messages = [
      new UserMessage('Weather in Paris?'),
      new AssistantMessage('', [new ToolCall('fc_1', 'weather', { city: 'Paris' }, 'call_1')]),
    ];

    expect(body((p) => p.withMessages(messages))).toContain(
      '{"id":"fc_1","call_id":"call_1","type":"function_call","name":"weather","arguments":"{\\"city\\":\\"Paris\\"}"}',
    );
  });

  it('sends an empty prompt as a normal user turn (divergence from the reference)', () => {
    // The reference gates the prompt path on truthiness and drops both of these,
    // producing a request with no user message at all. That is a defect.
    expect(body((p) => p.withPrompt(''))).toBe(
      '{"model":"gpt-4o","input":[{"role":"user","content":[{"type":"input_text","text":""}]}],"max_output_tokens":null}',
    );
    expect(body((p) => p.withPrompt('0'))).toBe(
      '{"model":"gpt-4o","input":[{"role":"user","content":[{"type":"input_text","text":"0"}]}],"max_output_tokens":null}',
    );
  });

  it('does not escape slashes or non-ASCII in the prompt', () => {
    expect(body((p) => p.withPrompt('Explain https://example.com/über — 日本語 too'))).toContain(
      'https://example.com/über — 日本語 too',
    );
  });
});

describe('toRequest', () => {
  it('refuses a request that sets both a prompt and messages', () => {
    try {
      Prism.text().using('openai', 'gpt-4o').withMessages([new UserMessage('a')]).withPrompt('b').toRequest();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PrismError);
      expect((error as PrismError).code).toBe('prompt_and_messages');
    }
  });

  it('accepts a prompt alongside an EMPTY message list', () => {
    expect(() => Prism.text().using('openai', 'gpt-4o').withMessages([]).withPrompt('').toRequest()).not.toThrow();
  });

  it('appends system prompts rather than replacing them', () => {
    const request = Prism.text()
      .using('openai', 'gpt-4o')
      .withSystemPrompt('A')
      .withSystemPrompt('B')
      .withPrompt('hi')
      .toRequest();

    expect(request.systemPrompts().map((prompt) => prompt.content)).toEqual(['A', 'B']);
  });

  it('carries the remaining builder settings through untouched', () => {
    const request = Prism.text()
      .using('openai', 'gpt-4o')
      .withPrompt('hi')
      .usingTopK(40)
      .withMaxSteps(3)
      .withClientOptions({ signal: null })
      .toRequest();

    expect(request.topK()).toBe(40);
    expect(request.maxSteps()).toBe(3);
    expect(request.clientOptions()).toEqual({ signal: null });
    expect(request.provider()).toBe('openai');
    expect(request.model()).toBe('gpt-4o');
  });

  it('relaxes a forced tool choice back to Auto once a tool has run', () => {
    const request = Prism.text().using('openai', 'gpt-4o').withPrompt('hi').withToolChoice(ToolChoice.Any).toRequest();

    expect(request.resetToolChoice().toolChoice()).toBe(ToolChoice.Auto);
  });
});

describe('provider resolution', () => {
  it('fails with a code for an unregistered provider', () => {
    try {
      Prism.text().using('not-a-provider', 'x');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as PrismError).code).toBe('unsupported_provider_action');
    }
  });

  it('fails with a code when asText is called without a provider', async () => {
    await expect(Prism.text().withPrompt('hi').asText()).rejects.toMatchObject({
      code: 'unsupported_provider_action',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { FinishReason, Meta, ObjectSchema, Prism, ResponseBuilder, StringSchema, TextStep, ToolCall, ToolResult, Usage, structuredFromTextResponse } from '../src/index.js';
import type { HttpRequest, HttpTransport, JsonObject } from '../src/index.js';

const schema = new ObjectSchema('output', 'The output', [new StringSchema('result', 'Result')], {
  requiredFields: ['result'],
});
const json = '{"result":"héllo"}';
const fixtures = {
  openai: {
    id: 'structured', model: 'gpt-4o', status: 'completed',
    output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: json }] }],
    usage: { input_tokens: 12, output_tokens: 7 },
  },
  anthropic: {
    id: 'structured', model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: json }], usage: { input_tokens: 12, output_tokens: 7 },
  },
  mistral: {
    id: 'structured', model: 'mistral-small-latest',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: json } }],
    usage: { prompt_tokens: 12, completion_tokens: 7 },
  },
} satisfies Record<string, JsonObject>;

function recorder(body: JsonObject) {
  const calls: HttpRequest[] = [];
  const transport: HttpTransport = async (request) => {
    calls.push(request);
    return { status: 200, headers: {}, body, rawBody: JSON.stringify(body) };
  };
  return { calls, transport };
}

describe('structured conversation', () => {
  it.each(['openai', 'anthropic', 'mistral'] as const)('%s keeps the complete native structured shape', async (provider) => {
    const fixture = fixtures[provider];
    const { calls, transport } = recorder(fixture);
    const response = await Prism.structured()
      .using(provider, fixture.model as string, { apiKey: 'fixture-only', transport })
      .withSchema(schema).withPrompt('Return JSON.').asStructured();
    const object = response.toObject();
    expect(calls).toHaveLength(1);
    expect(response.structured).toEqual({ result: 'héllo' });
    expect(response.usage.promptTokens).toBe(12);
    expect(response.usage.completionTokens).toBe(7);
    expect(object).toMatchObject({ tool_calls: [], provider_tool_calls: [], tool_results: [] });
    const step = (object.steps as JsonObject[])[0] as JsonObject;
    expect(step.structured).toEqual(provider === 'mistral' ? {} : { result: 'héllo' });
    expect(step).not.toHaveProperty('tool_approval_requests');
    const messages = step.messages as JsonObject[];
    expect(messages).toHaveLength(2);
    expect(messages.at(-1)).toMatchObject({ type: 'assistant', content: json, tool_calls: [] });
    expect(response.text).toBe(provider === 'anthropic' ? '' : json);
    expect(step.text).toBe(response.text);
    expect(step.raw).toEqual(fixture);
    expect(object.raw).toEqual(fixture);
  });

  it.each([undefined, false])('Anthropic native mode (%s) sends schema and effort without changing messages', async (mode) => {
    const { calls, transport } = recorder(fixtures.anthropic);
    const request = Prism.structured().using('anthropic', 'claude-sonnet-4-5', { apiKey: 'fixture-only', transport })
      .withSchema(schema).withPrompt('Return JSON.').withProviderOptions({ effort: 'high', ...(mode === undefined ? {} : { use_tool_calling: mode }) })
      .toRequest();
    const before = request.messages().map(message => message.toObject());
    const { Anthropic } = await import('../src/providers/anthropic/anthropic.js');
    const provider = new Anthropic({ apiKey: 'fixture-only', transport });
    await provider.structured(request);
    await provider.structured(request);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toBe(calls[1]?.body);
    expect(request.messages().map(message => message.toObject())).toEqual(before);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Return JSON.' }] }]);
    expect(body.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema: schema.toObject() } });
    expect(body).not.toHaveProperty('tools');
    expect(calls[0]?.body).not.toContain('Respond with ONLY JSON');
  });

  it.each([true, 1, 'enabled', { mode: 'tool' }])('refuses structured-tool mode %j before any HTTP', async (mode) => {
    const { calls, transport } = recorder(fixtures.anthropic);
    await expect(Prism.structured().using('anthropic', 'claude-sonnet-4-5', { apiKey: 'fixture-only', transport })
      .withSchema(schema).withPrompt('Return JSON.').withProviderOptions({ use_tool_calling: mode })
      .asStructured()).rejects.toMatchObject({ code: 'unsupported_provider_action' });
    expect(calls).toHaveLength(0);
  });

  it('keeps the ordinary Anthropic text path unchanged', async () => {
    const { calls, transport } = recorder(fixtures.anthropic);
    const response = await Prism.text().using('anthropic', 'claude-sonnet-4-5', { apiKey: 'fixture-only', transport })
      .withPrompt('Return JSON.').asText();
    expect(response.text).toBe(json);
    expect(JSON.parse(calls[0]?.body ?? '{}')).not.toHaveProperty('output_config');
    expect((response.toObject().steps as JsonObject[])[0]).toHaveProperty('tool_approval_requests');
  });

  it('refuses citations with native schema mode before HTTP', async () => {
    const { calls, transport } = recorder(fixtures.anthropic);
    await expect(Prism.structured().using('anthropic', 'claude-sonnet-4-5', { apiKey: 'fixture-only', transport })
      .withSchema(schema).withPrompt('Return JSON.').withProviderOptions({ citations: true })
      .asStructured()).rejects.toMatchObject({ code: 'unsupported_provider_action' });
    expect(calls).toHaveLength(0);
  });

  it('retains nonempty tool fields from every step without changing the text response', () => {
    const builder = new ResponseBuilder();
    for (const id of ['one', 'two']) {
      builder.addStep(new TextStep({ text: json, finishReason: FinishReason.Stop,
        usage: new Usage(12, 7), meta: new Meta(id, 'fixture'),
        toolCalls: [new ToolCall(id, 'lookup', { id })],
        toolResults: [new ToolResult(id, 'lookup', { id }, { result: id })],
        providerToolCalls: [{ id, type: 'search', status: 'completed', data: { opaque: id } }],
        toolApprovalRequests: [{ id: 'approval-' + id }],
      }));
    }
    const text = builder.toResponse();
    const before = text.toObject();
    const structured = structuredFromTextResponse(text);
    expect(text.toObject()).toEqual(before);
    const object = structured.toObject();
    expect((object.tool_calls as JsonObject[]).map(call => call.id)).toEqual(['one', 'two']);
    expect((object.provider_tool_calls as JsonObject[]).map(call => call.id)).toEqual(['one', 'two']);
    expect((object.tool_results as JsonObject[]).map(result => result.tool_call_id)).toEqual(['one', 'two']);
    const steps = object.steps as JsonObject[];
    expect(steps[0]?.tool_calls).toEqual((object.tool_calls as JsonObject[]).slice(0, 1));
    expect(steps[1]?.tool_results).toEqual((object.tool_results as JsonObject[]).slice(1));
    expect(steps.every(step => !('tool_approval_requests' in step))).toBe(true);
    expect(((steps[0]?.messages as JsonObject[])[0] as JsonObject).tool_approval_requests).toEqual([{ id: 'approval-one' }]);
  });

  it('keeps OpenAI structured replay while the text path retains its reasoning summary', async () => {
    const reasoning = { type: 'reasoning', id: 'reasoning-fixture', encrypted_content: 'fixture-only',
      summary: [{ type: 'summary_text', text: 'Separate reasoning summary.' }] };
    const body = { ...fixtures.openai, output: [reasoning, ...fixtures.openai.output] };
    const { transport } = recorder(body);
    const structured = await Prism.structured().using('openai', 'gpt-4o', { apiKey: 'fixture-only', transport })
      .withSchema(schema).withPrompt('Return JSON.').asStructured();
    expect(structured.additionalContent).not.toHaveProperty('reasoningSummaries');
    expect(structured.additionalContent.output_items).toEqual(body.output);
    expect(structured.raw).toEqual(body);
    const text = await Prism.text().using('openai', 'gpt-4o', { apiKey: 'fixture-only', transport })
      .withPrompt('Return JSON.').asText();
    expect(text.additionalContent.reasoningSummaries).toEqual(['Separate reasoning summary.']);
  });
});

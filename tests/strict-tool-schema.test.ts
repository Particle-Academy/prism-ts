import { describe, expect, it } from 'vitest';
import { ObjectSchema, Prism, PrismError, StringSchema, Tool } from '../src/index.js';
import type { HttpRequest, HttpTransport, JsonObject } from '../src/index.js';

type Shape = 'flat' | 'nested' | 'empty';
const providers = ['openai', 'anthropic'] as const;

function fixture() {
  const calls: HttpRequest[] = [];
  const body = {
    id: 'synthetic', model: 'synthetic', status: 'completed', type: 'message', role: 'assistant',
    content: [{ type: 'text', text: 'Synthetic only.' }], stop_reason: 'end_turn',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic only.' }] }],
    choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic only.' }, finish_reason: 'stop' }],
    usage: { input_tokens: 1, output_tokens: 1, prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  const transport: HttpTransport = (request) => {
    calls.push(request);
    return Promise.resolve({ status: 200, headers: {}, body, rawBody: JSON.stringify(body) });
  };
  return { calls, transport };
}

function tool(shape: Shape, strict?: boolean) {
  const value = new Tool().as('synthetic_search').for('Synthetic only.');
  if (shape === 'flat') value.withStringParameter('query', 'Synthetic query.');
  if (shape === 'nested') {
    value.withParameter(new ObjectSchema('profile', 'Synthetic profile.', [new StringSchema('region', 'Synthetic region.')], { requiredFields: ['region'] }));
  }
  if (strict !== undefined) value.withProviderOptions({ strict });
  return value;
}

async function send(provider: string, value: Tool, transport: HttpTransport) {
  return Prism.text().using(provider, 'synthetic', {
    apiKey: 'synthetic-not-a-provider-key', url: 'https://api.example.test/v1', transport,
  }).withPrompt('Synthetic only.').withTools([value]).asText();
}

function definition(calls: HttpRequest[]): JsonObject {
  expect(calls).toHaveLength(1);
  const body = JSON.parse(String(calls[0]?.body)) as JsonObject;
  return (body.tools as JsonObject[])[0] as JsonObject;
}

describe('strict tool schemas through the native provider request path', () => {
  for (const provider of providers) {
    for (const strict of [true, false]) {
      for (const shape of ['flat', 'nested', 'empty'] as const) {
        it(`${provider} sends the ${shape} schema with strict=${strict}`, async () => {
          const value = tool(shape, strict);
          const { calls, transport } = fixture();
          await send(provider, value, transport);
          const mapped = definition(calls);
          expect(mapped.name).toBe('synthetic_search');
          expect(mapped).not.toHaveProperty('function');
          if (strict) expect(mapped.strict).toBe(true);
          else expect(mapped).not.toHaveProperty('strict');
          const key = provider === 'anthropic' ? 'input_schema' : 'parameters';
          if (shape === 'empty' && !strict && provider === 'openai') {
            expect(mapped).not.toHaveProperty(key);
          } else {
            expect(mapped).toHaveProperty(key);
            const root = mapped[key] as JsonObject;
            expect(root.type).toBe('object');
            expect(root.required).toEqual(shape === 'empty' ? [] : [shape === 'flat' ? 'query' : 'profile']);
            expect(root.properties).toEqual(value.parametersAsObject());
            if (shape === 'empty') expect(JSON.stringify(root.properties)).toBe('{}');
            if (strict) expect(root.additionalProperties).toBe(false);
            else expect(root).not.toHaveProperty('additionalProperties');
          }
        });
      }
    }
  }

  it('refuses optional OpenAI strict root fields before the transport is called', async () => {
    const value = new Tool().as('synthetic_optional').for('Synthetic only.')
      .withStringParameter('query', 'Synthetic query.', false)
      .withStringParameter('region', 'Synthetic region.', false).withProviderOptions({ strict: true });
    const { calls, transport } = fixture();
    const result = send('openai', value, transport);
    await expect(result).rejects.toBeInstanceOf(PrismError);
    await expect(result).rejects.toMatchObject({ code: 'invalid_tool_schema' });
    for (const word of ['synthetic_optional', 'query', 'region', 'required', 'nullable', 'strict']) {
      await expect(result).rejects.toThrow(word);
    }
    expect(calls).toHaveLength(0);
  });

  for (const provider of providers) {
    for (const strict of [true, false]) {
      it(`${provider} preserves nullable fields and declared requirements with strict=${strict}`, async () => {
        const value = new Tool().as('nullable').for('Synthetic only.')
          .withParameter(new StringSchema('query', 'Synthetic query.', { nullable: true }), strict)
          .withProviderOptions({ strict });
        const { calls, transport } = fixture();
        await send(provider, value, transport);
        const root = definition(calls)[provider === 'anthropic' ? 'input_schema' : 'parameters'] as JsonObject;
        expect(root.required).toEqual(strict ? ['query'] : []);
        expect((root.properties as JsonObject).query).toEqual({ description: 'Synthetic query.', type: ['string', 'null'] });
      });
    }

    it(`${provider} leaves nested caller schemas unchanged`, async () => {
      const nested = new ObjectSchema('profile', 'Caller schema.', [new StringSchema('note', 'Optional note.')], { requiredFields: [], allowAdditionalProperties: true });
      const before = JSON.stringify(nested.toObject());
      const value = new Tool().as('nested').for('Synthetic only.').withParameter(nested).withProviderOptions({ strict: true });
      const { calls, transport } = fixture();
      await send(provider, value, transport);
      const root = definition(calls)[provider === 'anthropic' ? 'input_schema' : 'parameters'] as JsonObject;
      expect((root.properties as JsonObject).profile).toEqual(JSON.parse(before));
      expect(root.additionalProperties).toBe(false);
      expect(JSON.stringify(nested.toObject())).toBe(before);
    });

    for (const shape of ['flat', 'empty'] as const) {
      it(`${provider} keeps the shipped absent-strict default for ${shape} tools`, async () => {
        const { calls, transport } = fixture();
        await send(provider, tool(shape), transport);
        const mapped = definition(calls);
        expect(mapped).not.toHaveProperty('strict');
        const key = provider === 'anthropic' ? 'input_schema' : 'parameters';
        if (provider === 'openai' && shape === 'empty') expect(mapped).not.toHaveProperty(key);
        else expect(mapped[key]).not.toHaveProperty('additionalProperties');
      });
    }
  }

  it('keeps optional strict Anthropic fields without an OpenAI-only restriction', async () => {
    const value = new Tool().as('optional').for('Synthetic only.').withStringParameter('query', 'Synthetic.', false).withProviderOptions({ strict: true });
    const { calls, transport } = fixture();
    await send('anthropic', value, transport);
    const root = definition(calls).input_schema as JsonObject;
    expect(root.required).toEqual([]);
    expect(root.additionalProperties).toBe(false);
  });

  it('recomputes strict behavior when the same tool is reused with strict disabled', async () => {
    const value = tool('empty', true);
    const first = fixture();
    await send('openai', value, first.transport);
    expect(definition(first.calls)).toHaveProperty('parameters');
    value.withProviderOptions({ strict: false });
    const second = fixture();
    await send('openai', value, second.transport);
    expect(definition(second.calls)).not.toHaveProperty('parameters');
    expect(definition(second.calls)).not.toHaveProperty('strict');
  });

  for (const strict of [true, false]) {
    it(`keeps Mistral's native optional schema unchanged with strict=${strict}`, async () => {
      const value = new Tool().as('optional').for('Synthetic only.').withStringParameter('query', 'Synthetic.', false).withProviderOptions({ strict });
      const { calls, transport } = fixture();
      await send('mistral', value, transport);
      const mapped = definition(calls);
      const fn = mapped.function as JsonObject;
      expect(mapped).not.toHaveProperty('strict');
      expect(fn).not.toHaveProperty('strict');
      expect((fn.parameters as JsonObject).required).toEqual([]);
      expect(fn.parameters).not.toHaveProperty('additionalProperties');
    });
  }

  for (const provider of ['azure', 'deepseek']) {
    it(`keeps the ${provider} integration explicitly unsupported`, async () => {
      const { calls, transport } = fixture();
      await expect(send(provider, tool('empty', true), transport)).rejects.toMatchObject({ code: 'unsupported_provider_action' });
      expect(calls).toHaveLength(0);
    });
  }
});

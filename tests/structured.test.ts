import { describe, expect, it } from 'vitest';
import {
  ObjectSchema,
  Prism,
  PrismError,
  StringSchema,
  StructuredMode,
  extractStructured,
} from '../src/index.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/index.js';

const SCHEMA = new ObjectSchema('person', 'A person', [
  new StringSchema('name', 'Their name'),
], { requiredFields: ['name'] });

function transportReturning(text: string): { transport: HttpTransport; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const body = {
    id: 'resp_1',
    model: 'gpt-4o',
    status: 'completed',
    output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 10, output_tokens: 2 },
  };

  const transport: HttpTransport = (request) => {
    calls.push(request);

    return Promise.resolve({ status: 200, headers: {}, body, rawBody: JSON.stringify(body) } as HttpResponse);
  };

  return { transport, calls };
}

describe('structured output', () => {
  it('asks OpenAI to enforce the schema for a model that supports it', async () => {
    const { transport, calls } = transportReturning('{"name":"Ada"}');

    const response = await Prism.structured()
      .using('openai', 'gpt-4o', { apiKey: 'sk-test', transport })
      .withSchema(SCHEMA)
      .withPrompt('Who?')
      .asStructured();

    const sent = JSON.parse(calls[0]?.body ?? '{}');

    expect(sent.text.format.type).toBe('json_schema');
    // strict is the whole reason to prefer this mode: without it a near-miss
    // that parses but omits a required field comes back looking fine.
    expect(sent.text.format.strict).toBe(true);
    expect(response.structured).toEqual({ name: 'Ada' });
    expect(response.text).toBe('{"name":"Ada"}');
  });

  it('falls back to json mode for a model that cannot enforce a schema', async () => {
    const { transport, calls } = transportReturning('{"name":"Ada"}');

    await Prism.structured()
      .using('openai', 'gpt-3.5-turbo', { apiKey: 'sk-test', transport })
      .withSchema(SCHEMA)
      .withPrompt('Who?')
      .asStructured();

    expect(JSON.parse(calls[0]?.body ?? '{}').text.format).toEqual({ type: 'json_object' });
  });

  it('refuses a model that cannot do structured output at all', async () => {
    await expect(
      Prism.structured()
        .using('openai', 'o1-mini', { apiKey: 'sk-test', transport: transportReturning('{}').transport })
        .withSchema(SCHEMA)
        .withPrompt('Who?')
        .asStructured(),
    ).rejects.toThrowError(/not supported for o1-mini/);
  });

  it('reads a fine-tune capability from its base model', async () => {
    const { transport, calls } = transportReturning('{"name":"Ada"}');

    await Prism.structured()
      .using('openai', 'ft:gpt-4o:acme:tuned:abc123', { apiKey: 'sk-test', transport })
      .withSchema(SCHEMA)
      .withPrompt('Who?')
      .asStructured();

    // Matching the prefix against the whole string would classify every
    // fine-tune as JSON-only, including ones built on gpt-4o.
    expect(JSON.parse(calls[0]?.body ?? '{}').text.format.type).toBe('json_schema');
  });

  it('honours an explicit mode over the resolver', async () => {
    const { transport, calls } = transportReturning('{"name":"Ada"}');

    await Prism.structured()
      .using('openai', 'gpt-4o', { apiKey: 'sk-test', transport })
      .withSchema(SCHEMA)
      .usingStructuredMode(StructuredMode.Json)
      .withPrompt('Who?')
      .asStructured();

    expect(JSON.parse(calls[0]?.body ?? '{}').text.format).toEqual({ type: 'json_object' });
  });

  it('refuses a structured request with no schema', () => {
    expect(() =>
      Prism.structured().using('openai', 'gpt-4o', { apiKey: 'sk-test' }).withPrompt('Who?').toRequest(),
    ).toThrowError(PrismError);
  });

  it('asks Anthropic for JSON in the prompt, since it cannot enforce a schema', async () => {
    const body = {
      id: 'msg_1',
      model: 'claude-sonnet-4-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"name":"Ada"}' }],
      usage: { input_tokens: 4, output_tokens: 2 },
    };
    const calls: HttpRequest[] = [];
    const transport: HttpTransport = (request) => {
      calls.push(request);

      return Promise.resolve({ status: 200, headers: {}, body, rawBody: JSON.stringify(body) } as HttpResponse);
    };

    const response = await Prism.structured()
      .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', transport })
      .withSchema(SCHEMA)
      .withPrompt('Who?')
      .asStructured();

    expect(calls[0]?.body).toContain('Respond with ONLY JSON');
    expect(response.structured).toEqual({ name: 'Ada' });
  });

  it('keeps the text and reports null when the answer is not an object', async () => {
    // A refusal is an answer, not a crash. Throwing here would destroy the one
    // artifact that explains why it did not parse.
    const { transport } = transportReturning('I am afraid I cannot help with that.');

    const response = await Prism.structured()
      .using('openai', 'gpt-4o', { apiKey: 'sk-test', transport })
      .withSchema(SCHEMA)
      .withPrompt('Who?')
      .asStructured();

    expect(response.structured).toBeNull();
    expect(response.text).toBe('I am afraid I cannot help with that.');
  });

  it('unfences JSON a model wrapped in a code block anyway', () => {
    expect(extractStructured('```json\n{"name":"Ada"}\n```')).toEqual({ name: 'Ada' });
  });

  it('rejects a parsed value that is not an object', () => {
    // `[1,2,3]` parses. Returning it as "structured" would satisfy the type and
    // break the first caller to read a property off it.
    expect(extractStructured('[1,2,3]')).toBeNull();
    expect(extractStructured('"just a string"')).toBeNull();
  });
});

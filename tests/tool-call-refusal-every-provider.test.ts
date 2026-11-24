import { describe, expect, it } from 'vitest';
import { ObjectSchema, Prism, StringSchema, Tool } from '../src/index.js';
import type { HttpResponse, HttpTransport } from '../src/index.js';

/*
 * G-352 in the PHP reference: non-streaming handlers dropped the pending
 * approval requests from their response, so a resume denied every approval.
 * That gap needs a tool loop that stops for an approval. This port has none:
 * every provider's text and structured path refuses a reply that finished on
 * tool calls, before any handler runs and before a second request. These
 * cases check that for every provider here, so the claim cannot go stale
 * when a provider is added or one of them starts running tools.
 */

const TOOL_CALL_BODIES: Record<string, unknown> = {
  anthropic: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'delete_file', input: { path: 'a.txt' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  mistral: {
    id: 'cmpl-1',
    object: 'chat.completion',
    model: 'test-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'delete_file', arguments: '{"path":"a.txt"}' } }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  },
  openai: {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'test-model',
    output: [{ id: 'fc_1', type: 'function_call', status: 'completed', call_id: 'call_1', name: 'delete_file', arguments: '{"path":"a.txt"}' }],
    usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 },
  },
};

function fake(body: unknown): { transport: HttpTransport; calls: () => number } {
  let calls = 0;
  const transport: HttpTransport = () => {
    calls += 1;

    return Promise.resolve({ status: 200, headers: {}, body, rawBody: JSON.stringify(body) } as HttpResponse);
  };

  return { transport, calls: () => calls };
}

function deleteFile(onRun: () => void): Tool {
  return new Tool().as('delete_file').for('Delete a file').withStringParameter('path', 'Path').using(() => {
    onRun();

    return 'deleted';
  });
}

const schema = new ObjectSchema('answer', 'The answer', [new StringSchema('answer', 'The answer')], { requiredFields: ['answer'] });

describe('a reply that finished on tool calls, on every provider', () => {
  it.each(Object.keys(TOOL_CALL_BODIES))('is refused on the text path without running the tool (%s)', async (provider) => {
    let ran = 0;
    const { transport, calls } = fake(TOOL_CALL_BODIES[provider]);

    const request = Prism.text()
      .using(provider, 'test-model', { apiKey: 'sk-test', url: 'https://api.example.test/v1', transport })
      .withTools([deleteFile(() => { ran += 1; })])
      .withMaxSteps(3)
      .withPrompt('Delete a.txt.')
      .withMaxTokens(64)
      .asText();

    await expect(request).rejects.toMatchObject({ code: 'tool_loop_not_supported' });
    expect(ran).toBe(0);
    expect(calls()).toBe(1);
  });

  it.each(Object.keys(TOOL_CALL_BODIES))('is refused on the structured path without running the tool (%s)', async (provider) => {
    let ran = 0;
    const { transport, calls } = fake(TOOL_CALL_BODIES[provider]);

    const request = Prism.structured()
      .using(provider, 'test-model', { apiKey: 'sk-test', url: 'https://api.example.test/v1', transport })
      .withSchema(schema)
      .withTools([deleteFile(() => { ran += 1; })])
      .withMaxSteps(3)
      .withPrompt('Delete a.txt.')
      .withMaxTokens(64)
      .asStructured();

    await expect(request).rejects.toMatchObject({ code: 'tool_loop_not_supported' });
    expect(ran).toBe(0);
    expect(calls()).toBe(1);
  });
});

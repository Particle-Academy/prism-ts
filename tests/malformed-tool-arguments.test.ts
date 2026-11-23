import { describe, expect, it } from 'vitest';
import {
  AssistantMessage,
  Prism,
  PrismError,
  ToolCall,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from '../src/index.js';
import type { HttpRequest, HttpTransport, JsonObject } from '../src/index.js';

const MALFORMED = '{"city": ';

const RESPONSES: Record<string, JsonObject> = {
  openai: {
    id: 'r1',
    model: 'm',
    status: 'completed',
    output: [{ id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok' }] }],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  anthropic: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  mistral: {
    id: 'c1',
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  },
};

function recording(provider: string): { transport: HttpTransport; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const body = RESPONSES[provider] as JsonObject;
  const transport: HttpTransport = (request) => {
    calls.push(request);

    return Promise.resolve({ status: 200, headers: {}, body, rawBody: JSON.stringify(body) });
  };

  return { transport, calls };
}

function answeredHistory(args: string): (UserMessage | AssistantMessage | ToolResultMessage)[] {
  return [
    new UserMessage('Weather?'),
    new AssistantMessage('', [new ToolCall('call_1', 'weather', args, 'call_1')]),
    new ToolResultMessage([new ToolResult('call_1', 'weather', {}, 'Tool call arguments are not valid JSON', 'call_1')]),
    new UserMessage('Again'),
  ];
}

/** The tool call as this provider's request carries it. */
function replayed(provider: string, call: HttpRequest | undefined): unknown {
  const body = JSON.parse(String(call?.body ?? '{}')) as Record<string, unknown>;

  if (provider === 'openai') {
    return (body.input as { type?: string; arguments?: unknown }[]).find((item) => item.type === 'function_call')?.arguments;
  }

  const messages = body.messages as { role: string; content: unknown; tool_calls?: { function: { arguments: unknown } }[] }[];

  if (provider === 'mistral') {
    return messages.find((message) => message.tool_calls !== undefined)?.tool_calls?.[0]?.function.arguments;
  }

  const assistant = messages.find((message) => message.role === 'assistant');

  return (assistant?.content as { type: string; input?: unknown }[]).find((block) => block.type === 'tool_use')?.input;
}

/** A request that fails to build fails its test on an assertion. */
async function failureOf(send: () => Promise<unknown>): Promise<string | null> {
  return await send().then(() => null, (error: unknown) => String(error));
}

describe('a tool call whose arguments could not be parsed', () => {
  for (const [provider, empty] of [['openai', '{}'], ['anthropic', {}], ['mistral', '{}']] as const) {
    it(`${provider}: replays empty once a tool result has answered it`, async () => {
      const { transport, calls } = recording(provider);
      const history = answeredHistory(MALFORMED);

      expect(await failureOf(() => Prism.text().using(provider, 'm', { transport }).withMessages(history).asText())).toBeNull();
      expect(replayed(provider, calls[0])).toEqual(empty);
      expect((history[1] as AssistantMessage).toolCalls[0]?.arguments).toBe(MALFORMED);
    });

    it(`${provider}: leaves well-formed arguments alone`, async () => {
      const { transport, calls } = recording(provider);

      expect(await failureOf(() => Prism.text().using(provider, 'm', { transport }).withMessages(answeredHistory('{"city":"Paris"}')).asText())).toBeNull();

      const sent = replayed(provider, calls[0]);

      expect(typeof sent === 'string' ? JSON.parse(sent) : sent).toEqual({ city: 'Paris' });
    });
  }

  for (const provider of ['openai', 'anthropic'] as const) {
    it(`${provider}: still fails at mapping when nothing has answered it`, async () => {
      const { transport, calls } = recording(provider);
      const pending = Prism.text().using(provider, 'm', { transport }).withMessages([
        new UserMessage('Weather?'),
        new AssistantMessage('', [new ToolCall('call_1', 'weather', MALFORMED, 'call_1')]),
      ]);

      await expect(pending.asText()).rejects.toSatisfy(
        (error: unknown) => error instanceof PrismError && error.code === 'malformed_tool_call_arguments',
      );
      expect(calls).toHaveLength(0);
    });
  }

  it('openai: replays a stored output item empty once answered', async () => {
    const { transport, calls } = recording('openai');
    const item = { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'weather', arguments: MALFORMED };

    expect(await failureOf(() => Prism.text().using('openai', 'm', { transport }).withMessages([
      new UserMessage('Weather?'),
      new AssistantMessage('', [new ToolCall('call_1', 'weather', MALFORMED, 'call_1')], { output_items: [item] }),
      new ToolResultMessage([new ToolResult('call_1', 'weather', {}, 'failed', 'call_1')]),
    ]).asText())).toBeNull();

    expect(replayed('openai', calls[0])).toBe('{}');
  });

  it.each([
    ['truncated JSON', MALFORMED, true],
    ['a number', '5', true],
    ['a string', '"x"', true],
    ['a list', '[1,2]', true],
    ['true', 'true', true],
    ['an integer key', '{"0":"x"}', true],
    ['a negative integer key', '{"-5":"x"}', true],
    ['an object', '{"city":"Paris"}', false],
    ['a leading-zero key', '{"01":"x"}', false],
    ['a key past the integer range', '{"9223372036854775808":"x"}', false],
    ['an empty object', '{}', false],
    ['an empty list', '[]', false],
    ['null', 'null', false],
    ['an empty string', '', false],
    ['the string 0', '0', false],
  ])('classifies %s', (_name, args, malformed) => {
    const call = new ToolCall('c', 't', args);

    expect(call).toHaveProperty('hasMalformedArguments');
    expect(call.hasMalformedArguments()).toBe(malformed);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantMessage,
  Prism,
  PrismError,
  ToolCall,
  ToolCallEvent,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from '../src/index.js';
import type { HttpRequest, HttpStreamTransport, HttpTransport, JsonObject, JsonValue } from '../src/index.js';

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

describe('parsedArguments on arguments that are not named values', () => {
  it.each([
    ['a number', '5'],
    ['a string', '"x"'],
    ['true', 'true'],
    ['false', 'false'],
    ['a list', '[1,2]'],
    ['an integer key', '{"0":"x"}'],
    ['truncated JSON', MALFORMED],
  ])('refuses %s rather than returning an empty object', (_name, args) => {
    let returned: unknown = 'nothing returned';
    let code: unknown = null;

    try {
      returned = new ToolCall('c', 'weather', args).parsedArguments();
    } catch (error) {
      code = error instanceof PrismError ? error.code : String(error);
    }

    expect(returned).toBe('nothing returned');
    expect(code).toBe('malformed_tool_call_arguments');
  });

  it('refuses an already-decoded value with an integer key', () => {
    expect(() => new ToolCall('c', 'weather', { 0: 'x' }).parsedArguments()).toThrow(PrismError);
  });

  it.each([['an empty string', ''], ['the string 0', '0'], ['null', 'null'], ['an empty list', '[]'], ['an empty object', '{}']])(
    'still reads %s as no arguments',
    (_name, args) => {
      expect(new ToolCall('c', 'weather', args).parsedArguments()).toEqual({});
    },
  );

  it.each(['openai', 'anthropic'] as const)('%s: refuses an unanswered non-object call at mapping', async (provider) => {
    const { transport, calls } = recording(provider);
    const failure = await failureOf(() => Prism.text().using(provider, 'm', { transport }).withMessages([
      new UserMessage('Weather?'),
      new AssistantMessage('', [new ToolCall('call_1', 'weather', '5', 'call_1')]),
    ]).asText());

    expect(failure).toContain('not a JSON object');
    expect(calls).toHaveLength(0);
  });

  it.each(['openai', 'anthropic', 'mistral'] as const)('%s: still replays an answered non-object call empty', async (provider) => {
    const { transport, calls } = recording(provider);

    expect(await failureOf(() => Prism.text().using(provider, 'm', { transport }).withMessages(answeredHistory('5')).asText())).toBeNull();

    const sent = replayed(provider, calls[0]);

    expect(typeof sent === 'string' ? JSON.parse(sent) : sent).toEqual({});
  });
});

describe('arguments the three languages must read alike', () => {
  const nested = (depth: number): string => `${'{"a":'.repeat(depth - 1)}{}${'}'.repeat(depth - 1)}`;

  it.each([
    ['NaN inside a map', '{"a":NaN}'],
    ['Infinity inside a map', '{"a":Infinity}'],
    ['a lone high surrogate', '{"a":"\\ud800"}'],
    ['a lone low surrogate', '{"a":"\\udc00"}'],
    ['a lone surrogate in a key', '{"\\ud800":1}'],
    ['501 levels of nesting', nested(501)],
  ])('refuses %s', (_name, args) => {
    expect(new ToolCall('c', 't', args).hasMalformedArguments()).toBe(true);
  });

  it.each([
    ['a surrogate pair', '{"a":"\\ud83d\\ude00"}'],
    ['500 levels of nesting', nested(500)],
  ])('accepts %s', (_name, args) => {
    expect(new ToolCall('c', 't', args).hasMalformedArguments()).toBe(false);
  });

  it('mistral: refuses an unanswered unusable call at mapping', async () => {
    const { transport, calls } = recording('mistral');
    const failure = await failureOf(() => Prism.text().using('mistral', 'm', { transport }).withMessages([
      new UserMessage('Weather?'),
      new AssistantMessage('', [new ToolCall('call_1', 'weather', '5', 'call_1')]),
    ]).asText());

    expect(failure).toContain('not a JSON object');
    expect(calls).toHaveLength(0);
  });
});

// Every test below injects a transport; anything that reaches fetch is a bug.
describe('arguments a follow-up request could not carry', () => {
  const realRequests = vi.fn(() => {
    throw new Error('A test tried to use the network.');
  });

  beforeEach(() => {
    realRequests.mockClear();
    vi.stubGlobal('fetch', realRequests);
  });

  afterEach(() => {
    expect(realRequests).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  const unusable: [string, string][] = [
    ['a number past the float range', '{"amount":1e999}'],
    ['a nested negative one', '{"a":{"b":[-1e999]}}'],
    ['an integer past the float range', `{"amount":1${'0'.repeat(400)}}`],
    ['a key starting with NUL', '{"amount":"5","\\u0000a":1}'],
    ['a nested key starting with NUL', '{"a":[{"\\u0000b":1}]}'],
    ['a control character inside a number', '{"amount":1\u000100}'],
    ['a control character inside a literal', 'nu\u0001ll'],
    ['a control character between tokens', '{"amount"\u0001:1}'],
    ['a control character after a backslash', '{"a":"b\\\u0001"}'],
  ];

  for (const [label, args] of unusable) {
    it(`refuses ${label}`, () => {
      const call = new ToolCall('c', 'probe', args);

      expect(call.hasMalformedArguments()).toBe(true);
      expect(call.withoutMalformedArguments().parsedArguments()).toEqual({});
    });

    for (const provider of ['openai', 'anthropic', 'mistral'] as const) {
      it(`${provider}: replays ${label} as empty once answered`, async () => {
        const { transport, calls } = recording(provider);

        expect(await failureOf(() => Prism.text().using(provider, 'm', { transport }).withMessages(answeredHistory(args)).asText())).toBeNull();
        expect(calls).toHaveLength(1);

        const sent = replayed(provider, calls[0]);

        expect(typeof sent === 'string' ? JSON.parse(sent) : sent).toEqual({});
      });
    }
  }

  it('keeps a control character inside a string as the value the model sent', () => {
    const call = new ToolCall('c', 'probe', '{"note":"a\u0001b\nc","n":1}');

    expect(call.hasMalformedArguments()).toBe(false);
    expect(call.parsedArguments()).toEqual({ note: 'a\u0001b\nc', n: 1 });
  });

  it('accepts a long digit key and a NUL that does not start a key', () => {
    const key = '7'.repeat(5000);
    const call = new ToolCall('c', 'probe', `{"${key}":1,"a\\u0000b":2}`);

    expect(call.hasMalformedArguments()).toBe(false);
    expect(Object.keys(call.parsedArguments())).toEqual([key, 'a\u0000b']);
  });

  it('refuses a decoded map holding a value no request can carry', () => {
    for (const args of [{ a: Infinity }, { a: { b: NaN } }, { '\u0000a': 1 }, { a: { '\u0000b': 1 } }]) {
      expect(new ToolCall('c', 'probe', args as JsonObject).hasMalformedArguments()).toBe(true);
    }
  });

  const nonText: [string, unknown, boolean][] = [
    ['a number', 5, true],
    ['zero', 0, true],
    ['a float zero', 0.0, true],
    ['true', true, true],
    ['false', false, true],
    ['a list', [1, 2], true],
    ['an integer-keyed map', { 0: 'x' }, true],
    ['null', null, false],
    ['an empty list', [], false],
  ];

  for (const [label, value, refused] of nonText) {
    it(`reads ${label} from a provider by what it is`, () => {
      expect(new ToolCall('c', 'probe', ToolCall.storableArguments(value)).hasMalformedArguments()).toBe(refused);
    });
  }

  const frames = (events: unknown[]): HttpStreamTransport => () => Promise.resolve({
    status: 200,
    headers: {},
    chunks: (async function* () {
      yield events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
    })(),
  });

  async function streamedCall(provider: 'openai' | 'anthropic' | 'mistral', events: unknown[]): Promise<ToolCall> {
    const used = vi.fn(frames(events));
    const seen: ToolCall[] = [];

    for await (const event of Prism.text().using(provider, 'm', { apiKey: 'k', streamTransport: used }).withPrompt('p').asStream()) {
      if (event instanceof ToolCallEvent) seen.push(event.toolCall);
    }

    expect(used).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);

    return seen[0] as ToolCall;
  }

  const mistralDeltas = (deltas: unknown[]): unknown[] => [
    ...deltas.map((value) => ({ id: 'c', model: 'm', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'probe', arguments: value } }] }, finish_reason: null }] })),
    { id: 'c', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];

  for (const [label, value] of [['a number', 5], ['a list', [1, 2]], ['true', true], ['an integer-keyed map', { 0: 'x' }]] as const) {
    it(`openai stream: refuses ${label}`, async () => {
      const call = await streamedCall('openai', [
        { type: 'response.output_item.done', item_id: 'fc_1', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'probe', arguments: value } },
      ]);

      expect(call.hasMalformedArguments()).toBe(true);
    });

    it(`mistral stream: refuses ${label}`, async () => {
      expect((await streamedCall('mistral', mistralDeltas([value]))).hasMalformedArguments()).toBe(true);
    });

    it(`anthropic stream: refuses ${label}`, async () => {
      const call = await streamedCall('anthropic', [
        { type: 'message_start', message: { id: 'm1', model: 'm', usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'probe', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: value } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]);

      expect(call.hasMalformedArguments()).toBe(true);
    });
  }

  it('mistral stream: refuses a number completing an object', async () => {
    expect((await streamedCall('mistral', mistralDeltas(['{"amount":', 5, '}']))).hasMalformedArguments()).toBe(true);
  });

  for (const [label, value] of [['a number', 5], ['true', true], ['a list', [1, 2]], ['an integer-keyed map', { 0: 'x' }]] as [string, JsonValue][]) {
    it(`non-stream parsers refuse ${label}`, async () => {
      const bodies: Record<string, JsonObject> = {
        openai: { id: 'r', model: 'm', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'probe', arguments: value }], usage: { input_tokens: 1, output_tokens: 1 } },
        anthropic: { id: 'm', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'call_1', name: 'probe', input: value }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
        mistral: { id: 'c', model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'probe', arguments: value } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      };

      for (const provider of ['openai', 'anthropic', 'mistral'] as const) {
        const body = bodies[provider] as JsonObject;
        const transport = vi.fn<HttpTransport>(() => Promise.resolve({ status: 200, headers: {}, body, rawBody: JSON.stringify(body) }));
        const response = await Prism.text().using(provider, 'm', { apiKey: 'k', transport }).withPrompt('p').asText();

        expect(transport).toHaveBeenCalledTimes(1);
        expect(response.toolCalls[0]?.hasMalformedArguments()).toBe(true);
      }
    });
  }

  for (const form of ['', '0', 'null', '[]']) {
    it(`mistral replays the empty form ${JSON.stringify(form)} as an object`, async () => {
      const { transport, calls } = recording('mistral');

      expect(await failureOf(() => Prism.text().using('mistral', 'm', { transport }).withMessages(answeredHistory(form)).asText())).toBeNull();
      expect(replayed('mistral', calls[0])).toBe('{}');
    });
  }

  it('accepts 500 levels of nesting and refuses 501', () => {
    const nested = (depth: number): string => `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;

    expect(new ToolCall('c', 'probe', nested(500)).hasMalformedArguments()).toBe(false);
    expect(new ToolCall('c', 'probe', nested(501)).hasMalformedArguments()).toBe(true);
  });
});

describe('argument keys that could bind by position', () => {
  const positional = ['{"0":"prod"}', '["prod"]', '{"0":"prod","note":"x"}', '{"note":"x","1":"prod"}', '{"-1":"prod"}'];
  const named = ['{"00":"prod"}', '{"1.0":"prod"}', '{"-0":"prod"}', '{"+1":"prod"}', '{" 1":"prod"}'];

  for (const args of positional) {
    it(`refuses ${args} before any request is built`, async () => {
      const network = vi.fn(() => { throw new Error('A test tried to use the network.'); });
      vi.stubGlobal('fetch', network);
      const { transport, calls } = recording('openai');
      const pending = Prism.text().using('openai', 'm', { transport }).withMessages([
        new UserMessage('Go'),
        new AssistantMessage('', [new ToolCall('call_1', 'probe', args, 'call_1')]),
      ]);

      await expect(pending.asText()).rejects.toSatisfy(
        (error: unknown) => error instanceof PrismError && error.code === 'malformed_tool_call_arguments',
      );
      expect(calls).toHaveLength(0);
      expect(network).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  }

  for (const args of named) {
    it(`keeps ${args} as a named key`, () => {
      const call = new ToolCall('c', 'probe', args);

      expect(call.hasMalformedArguments()).toBe(false);
      expect(Object.values(call.parsedArguments())).toEqual(['prod']);
      expect(Object.keys(call.parsedArguments())).toEqual(Object.keys(JSON.parse(args) as object));
    });
  }
});

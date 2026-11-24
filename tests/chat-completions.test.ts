import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantMessage,
  configureProviders,
  Document,
  FinishReason,
  Image,
  ObjectSchema,
  Prism,
  StreamEndEvent,
  StreamStartEvent,
  StringSchema,
  TextCompleteEvent,
  TextDeltaEvent,
  TextStartEvent,
  Tool,
  ToolCall,
  ToolCallEvent,
  ToolChoice,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from '../src/index.js';
import type { StreamEvent } from '../src/index.js';
import { clearOpenAIEnvironment, installFakeFetch, jsonReply, sseReply } from './support/fake-fetch.js';
import type { FakeFetch } from './support/fake-fetch.js';

/*
 * G-321 D: the chat-completions api format on the OpenAI provider, for text,
 * structured and stream. Each case runs on BOTH routes to it: the built-in
 * `openai` with apiFormat chat_completions, and a named compatible provider.
 * The expected bodies are written out by hand from the reference's
 * RequestPayloadMap::chatText / chatStructured / chatStream.
 */

const KEY = 'sk-test-chat-key';
const COMPATIBLE = `chat-compat-${Date.now().toString(36)}`;

beforeAll(() => {
  configureProviders({ [COMPATIBLE]: { driver: 'openai-compatible', url: 'https://llm.example.test/v1', apiKey: KEY } });
});

const ROUTES = [
  { label: 'openai with apiFormat chat_completions', name: 'openai', config: { apiKey: KEY, url: 'https://llm.example.test/v1', apiFormat: 'chat_completions' } },
  { label: 'a compatible provider', name: COMPATIBLE, config: {} },
] as const;

function completion(message: Record<string, unknown>, finishReason: string | null = 'stop', usage: Record<string, unknown> = { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } }): Record<string, unknown> {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    model: 'gpt-test',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }],
    usage,
  };
}

const weather = (onRun: () => void = () => undefined): Tool =>
  new Tool().as('weather').for('Weather').withStringParameter('city', 'City').using(() => { onRun(); return 'sunny'; });

const schema = new ObjectSchema('answer', 'Pick one/é', [new StringSchema('answer', 'The answer')], { requiredFields: ['answer'] });

const INSTRUCTION = 'Respond with JSON that matches the following schema: \n {\n'
  + '    "description": "Pick one\\/\\u00e9",\n'
  + '    "type": "object",\n'
  + '    "properties": {\n'
  + '        "answer": {\n'
  + '            "description": "The answer",\n'
  + '            "type": "string"\n'
  + '        }\n'
  + '    },\n'
  + '    "required": [\n'
  + '        "answer"\n'
  + '    ],\n'
  + '    "additionalProperties": false\n'
  + '}';

let fake: FakeFetch;

beforeEach(() => {
  clearOpenAIEnvironment();
  fake = installFakeFetch();
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function collect(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);

  return events;
}

describe.each(ROUTES)('chat_completions text on $label', ({ name, config }) => {
  it('posts the reference body to <url>/chat/completions and reads the reply', async () => {
    fake.reply(jsonReply(completion({ content: 'Hello' }), 200, {
      'x-ratelimit-limit-requests': '100',
      'x-ratelimit-remaining-requests': '99',
    }));

    const response = await Prism.text().using(name, 'gpt-test', config)
      .withSystemPrompt('Be brief.')
      .withPrompt('Hi')
      .asText();

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(fake.sent[0]?.method).toBe('POST');
    expect(fake.sent[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(fake.sent[0]?.body).toBe(
      '{"model":"gpt-test","messages":[{"role":"system","content":"Be brief."},{"role":"user","content":[{"type":"text","text":"Hi"}]}]}',
    );
    expect(response.text).toBe('Hello');
    expect(response.finishReason).toBe(FinishReason.Stop);
    expect(response.usage.promptTokens).toBe(6);
    expect(response.usage.completionTokens).toBe(2);
    expect(response.usage.cacheReadInputTokens).toBe(4);
    expect(response.meta.id).toBe('chatcmpl-1');
    expect(response.meta.model).toBe('gpt-test');
    expect(response.meta.rateLimits.map((limit) => limit.name)).toEqual(['requests']);
  });

  it('sends every optional key the reference sends, and tools in the chat shape', async () => {
    fake.reply(jsonReply(completion({ content: 'ok' })));

    await Prism.text().using(name, 'gpt-test', config)
      .withPrompt('Hi', [Image.fromUrl('https://img.example.test/a.png'), Image.fromBase64('aGk=', 'image/png')])
      .withMaxTokens(64)
      .usingTemperature(0)
      .usingTopP(0.5)
      .withTools([weather()])
      .withToolChoice(ToolChoice.Any)
      .withProviderOptions({ text_verbosity: 'low' })
      .asText();

    expect(fake.sent[0]?.body).toBe(
      '{"model":"gpt-test","messages":[{"role":"user","content":[{"type":"text","text":"Hi"},'
      + '{"type":"image_url","image_url":{"url":"https://img.example.test/a.png"}},'
      + '{"type":"image_url","image_url":{"url":"data:image/png;base64,aGk="}}]}],'
      + '"max_tokens":64,"temperature":0,"top_p":0.5,'
      + '"tools":[{"type":"function","function":{"name":"weather","description":"Weather","parameters":{"type":"object","properties":{"city":{"description":"City","type":"string"}},"required":["city"]}}}],'
      + '"tool_choice":"required","verbosity":"low"}',
    );
  });

  it('names a forced tool as a function object and marks a strict tool', async () => {
    fake.reply(jsonReply(completion({ content: 'ok' })));

    await Prism.text().using(name, 'gpt-test', config)
      .withPrompt('Hi')
      .withTools([weather().withProviderOptions({ strict: true })])
      .withToolChoice('weather')
      .asText();

    expect(JSON.parse(fake.sent[0]?.body ?? '')).toMatchObject({
      tools: [{ type: 'function', function: { name: 'weather', description: 'Weather', strict: true, parameters: { additionalProperties: false } } }],
      tool_choice: { type: 'function', function: { name: 'weather' } },
    });
    expect(fake.sent[0]?.body).toContain('"description":"Weather","strict":true,"parameters"');
  });

  it('replays a conversation: assistant tool calls as a JSON string, one tool message per result', async () => {
    fake.reply(jsonReply(completion({ content: 'ok' })));

    await Prism.text().using(name, 'gpt-test', config)
      .withMessages([
        new UserMessage('Weather?'),
        new AssistantMessage('', [new ToolCall('call_1', 'weather', '{"city":"Paris"}')]),
        new ToolResultMessage([new ToolResult('call_1', 'weather', { city: 'Paris' }, 'sunny')]),
        new AssistantMessage('0'),
      ])
      .asText();

    expect(fake.sent[0]?.body).toBe(
      '{"model":"gpt-test","messages":['
      + '{"role":"user","content":[{"type":"text","text":"Weather?"}]},'
      + '{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\\"city\\":\\"Paris\\"}"}}]},'
      + '{"role":"tool","tool_call_id":"call_1","content":"sunny"},'
      + '{"role":"assistant","content":"0"}]}',
    );
  });

  it('returns a length-truncated answer rather than throwing, as the reference does', async () => {
    fake.reply(jsonReply(completion({ content: 'partial' }, 'length')));

    const response = await Prism.text().using(name, 'gpt-test', config).withPrompt('Hi').asText();

    expect(response.text).toBe('partial');
    expect(response.finishReason).toBe(FinishReason.Length);
  });

  it('refuses a finish reason the reference does not handle', async () => {
    fake.reply(jsonReply(completion({ content: '' }, 'content_filter')));

    await expect(Prism.text().using(name, 'gpt-test', config).withPrompt('Hi').asText())
      .rejects.toMatchObject({ code: 'provider_response_error' });
  });

  it('refuses a model refusal', async () => {
    fake.reply(jsonReply(completion({ content: null, refusal: 'I cannot help with that.' })));

    await expect(Prism.text().using(name, 'gpt-test', config).withPrompt('Hi').asText())
      .rejects.toThrow('I cannot help with that.');
  });

  it('turns an error payload inside a 200 into provider_response_error', async () => {
    fake.reply(jsonReply({ error: { type: 'invalid_request_error', message: 'bad model' } }));

    await expect(Prism.text().using(name, 'gpt-test', config).withPrompt('Hi').asText())
      .rejects.toMatchObject({ code: 'provider_response_error', message: expect.stringContaining('bad model') });
  });

  it('refuses a document it has nowhere to put, before any request', async () => {
    await expect(Prism.text().using(name, 'gpt-test', config)
      .withPrompt('Read this', [Document.fromText('hello', 'notes')])
      .asText()).rejects.toMatchObject({ code: 'unsupported_media' });
    expect(fake.sent).toHaveLength(0);
  });
});

describe.each(ROUTES)('tool calls on $label', ({ name, config }) => {
  const toolCallReply = (args: unknown): Record<string, unknown> => completion({
    content: null,
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: args } }],
  }, 'tool_calls');

  it('refuses a reply that finished on tool calls without running the tool or sending again (text)', async () => {
    let ran = 0;
    fake.reply(jsonReply(toolCallReply('{"city":"Paris"}')));

    await expect(Prism.text().using(name, 'gpt-test', config)
      .withTools([weather(() => { ran += 1; })])
      .withMaxSteps(3)
      .withPrompt('Weather?')
      .asText()).rejects.toMatchObject({ code: 'tool_loop_not_supported' });
    expect(ran).toBe(0);
    expect(fake.sent).toHaveLength(1);
  });

  it('refuses it on the structured path too', async () => {
    let ran = 0;
    fake.reply(jsonReply(toolCallReply('{"city":"Paris"}')));

    await expect(Prism.structured().using(name, 'gpt-test', config)
      .withSchema(schema)
      .withTools([weather(() => { ran += 1; })])
      .withMaxSteps(3)
      .withPrompt('Weather?')
      .asStructured()).rejects.toMatchObject({ code: 'tool_loop_not_supported' });
    expect(ran).toBe(0);
    expect(fake.sent).toHaveLength(1);
  });

  it.each([
    ['truncated JSON', '{"city": '],
    ['a JSON number', '42'],
    ['a non-string value', 42],
    ['a JSON list of values', '["Paris"]'],
  ])('holds garbled arguments (%s) unusable rather than as no arguments', async (_label, args) => {
    fake.reply(jsonReply(completion({
      content: 'done',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: args } }],
    }, 'stop')));

    const response = await Prism.text().using(name, 'gpt-test', config).withPrompt('Weather?').asText();
    const call = response.steps[0]?.toolCalls[0];

    expect(call).toBeDefined();
    let failure: unknown = null;
    try { call?.parsedArguments(); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'malformed_tool_call_arguments' });
  });

  it('refuses to replay an unanswered call with unusable arguments, before any request', async () => {
    await expect(Prism.text().using(name, 'gpt-test', config)
      .withMessages([new UserMessage('Weather?'), new AssistantMessage('', [new ToolCall('call_1', 'weather', '{"city": ')])])
      .asText()).rejects.toMatchObject({ code: 'malformed_tool_call_arguments' });
    expect(fake.sent).toHaveLength(0);
  });

  it('replays an ANSWERED call with unusable arguments as empty arguments', async () => {
    fake.reply(jsonReply(completion({ content: 'ok' })));

    await Prism.text().using(name, 'gpt-test', config)
      .withMessages([
        new UserMessage('Weather?'),
        new AssistantMessage('', [new ToolCall('call_1', 'weather', '{"city": ', 'call_1')]),
        new ToolResultMessage([new ToolResult('call_1', 'weather', {}, 'Tool call arguments are not valid JSON', 'call_1')]),
        new UserMessage('Again'),
      ])
      .asText();

    expect(fake.sent[0]?.body).toContain('"arguments":"{}"');
    expect(fake.sent[0]?.body).not.toContain('{\\"city\\": ');
  });
});

describe.each(ROUTES)('chat_completions structured on $label', ({ name, config }) => {
  it('sends json_object with the schema instruction, no tools, and reads the JSON back', async () => {
    fake.reply(jsonReply(completion({ content: '{"answer":"yes"}' })));

    const response = await Prism.structured().using(name, 'gpt-test', config)
      .withSchema(schema)
      .withSystemPrompt('Be brief.')
      .withPrompt('Yes or no?')
      .withTools([weather()])
      .asStructured();

    expect(fake.sent[0]?.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(JSON.parse(fake.sent[0]?.body ?? '')).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: [{ type: 'text', text: 'Yes or no?' }] },
        { role: 'system', content: INSTRUCTION },
      ],
      max_tokens: null,
      response_format: { type: 'json_object' },
    });
    expect(fake.sent[0]?.body.startsWith('{"model":"gpt-test","messages":')).toBe(true);
    expect(fake.sent[0]?.body).toContain('"max_tokens":null,"response_format":{"type":"json_object"}}');
    expect(response.structured).toEqual({ answer: 'yes' });
    expect(response.usage.promptTokens).toBe(6);
  });
});

describe.each(ROUTES)('chat_completions stream on $label', ({ name, config }) => {
  it('sends the reference stream body and maps the deltas', async () => {
    fake.reply(sseReply([
      { id: 'c1', model: 'gpt-test', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 1 } } },
      '[DONE]',
    ]));

    const events = await collect(Prism.text().using(name, 'gpt-test', config).withPrompt('Hi').withTools([weather()]).asStream());

    expect(fake.sent[0]?.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(fake.sent[0]?.headers.accept).toBe('text/event-stream');
    expect(fake.sent[0]?.body).toBe(
      '{"stream":true,"model":"gpt-test","messages":[{"role":"user","content":[{"type":"text","text":"Hi"}]}],"max_tokens":null,'
      + '"tools":[{"type":"function","function":{"name":"weather","description":"Weather","parameters":{"type":"object","properties":{"city":{"description":"City","type":"string"}},"required":["city"]}}}]}',
    );
    const order = [StreamStartEvent, TextStartEvent, TextDeltaEvent, TextDeltaEvent, TextCompleteEvent, StreamEndEvent];
    expect(events).toHaveLength(order.length);
    order.forEach((kind, index) => expect(events[index]).toBeInstanceOf(kind));
    expect((events[0] as StreamStartEvent).model).toBe('gpt-test');
    expect((events[2] as TextDeltaEvent).delta).toBe('Hel');
    expect((events[4] as TextCompleteEvent).text).toBe('Hello');
    expect(events[1]).toBeInstanceOf(TextStartEvent);
    const end = events[5] as StreamEndEvent;
    expect(end.finishReason).toBe(FinishReason.Stop);
    expect(end.usage?.promptTokens).toBe(4);
    expect(end.usage?.completionTokens).toBe(2);
    expect(end.usage?.cacheReadInputTokens).toBe(1);
  });

  it('assembles tool-call fragments, emits the call once, and never runs the tool', async () => {
    let ran = 0;
    fake.reply(sseReply([
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'weather', arguments: '' } }] }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ]));

    const events = await collect(Prism.text().using(name, 'gpt-test', config)
      .withPrompt('Weather?').withTools([weather(() => { ran += 1; })]).withMaxSteps(3).asStream());

    const calls = events.filter((event): event is ToolCallEvent => event instanceof ToolCallEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.toolCall.id).toBe('call_1');
    expect(calls[0]?.toolCall.name).toBe('weather');
    expect(calls[0]?.toolCall.parsedArguments()).toEqual({ city: 'Paris' });
    expect((events.at(-1) as StreamEndEvent).finishReason).toBe(FinishReason.ToolCalls);
    expect(ran).toBe(0);
    expect(fake.sent).toHaveLength(1);
  });

  it('holds a non-text argument fragment unusable', async () => {
    fake.reply(sseReply([
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'weather', arguments: '{"city":"Paris"' } }] }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 7 } }] }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]));

    const events = await collect(Prism.text().using(name, 'gpt-test', config).withPrompt('Weather?').withTools([weather()]).asStream());
    const call = events.find((event): event is ToolCallEvent => event instanceof ToolCallEvent);

    expect(() => call?.toolCall.parsedArguments()).toThrow();
    let failure: unknown = null;
    try { call?.toolCall.parsedArguments(); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'malformed_tool_call_arguments' });
  });

  it('throws on a streamed refusal instead of completing', async () => {
    fake.reply(sseReply([
      { id: 'c1', choices: [{ index: 0, delta: { refusal: 'I cannot ' }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { refusal: 'help.' }, finish_reason: 'stop' }] },
    ]));

    await expect(collect(Prism.text().using(name, 'gpt-test', config).withPrompt('Hi').asStream()))
      .rejects.toThrow('I cannot help.');
  });

  it('refuses an HTTP failure with the provider error path', async () => {
    fake.reply(jsonReply({ error: { message: 'rate limited' } }, 429));

    await expect(collect(Prism.text().using(name, 'gpt-test', config).withPrompt('Hi').asStream()))
      .rejects.toMatchObject({ code: 'provider_response_error', httpStatus: 429 });
  });
});

describe('api formats on the built-in openai provider', () => {
  it.each(['completions', 'messages'])('still refuses the unknown format %s for text and stream', async (apiFormat) => {
    const config = { apiKey: KEY, url: 'https://llm.example.test/v1', apiFormat };

    await expect(Prism.text().using('openai', 'gpt-test', config).withPrompt('Hi').asText())
      .rejects.toMatchObject({ code: 'unsupported_provider_action' });
    await expect(collect(Prism.text().using('openai', 'gpt-test', config).withPrompt('Hi').asStream()))
      .rejects.toMatchObject({ code: 'unsupported_provider_action' });
    expect(fake.sent).toHaveLength(0);
  });

  it('reads OPENAI_API_FORMAT=chat_completions for the built-in provider', async () => {
    vi.stubEnv('OPENAI_API_FORMAT', 'chat_completions');
    vi.stubEnv('OPENAI_API_KEY', KEY);
    fake.reply(jsonReply(completion({ content: 'ok' })));

    await Prism.text().using('openai', 'gpt-test').withPrompt('Hi').asText();

    expect(fake.sent[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
  });
});

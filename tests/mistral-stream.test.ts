import { describe, expect, it } from 'vitest';
import { FinishReason, MistralStreamMapper, Prism, StreamEventType } from '../src/index.js';
import type { HttpStreamResponse, HttpStreamTransport, JsonObject ,
  StreamEndEvent} from '../src/index.js';
import {
  TextCompleteEvent,
  ToolCallEvent,
} from '../src/index.js';

/** Mistral's chunks, as SSE frames. */
function streamOf(chunks: unknown[], trailing = 'data: [DONE]\n\n'): HttpStreamTransport {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + trailing;

  return () =>
    Promise.resolve({
      status: 200,
      headers: {},
      chunks: (async function* () {
        yield body;
      })(),
    } satisfies HttpStreamResponse);
}

const chunk = (delta: JsonObject, finishReason: string | null = null, extra: JsonObject = {}): JsonObject => ({
  id: 'cmpl-1',
  object: 'chat.completion.chunk',
  model: 'mistral-large-latest',
  choices: [{ index: 0, delta, finish_reason: finishReason }],
  ...extra,
});

async function collect(transport: HttpStreamTransport) {
  const events = [];

  for await (const event of Prism.text()
    .using('mistral', 'mistral-large-latest', { apiKey: 'sk-test', streamTransport: transport })
    .withPrompt('Hi')
    .asStream()) {
    events.push(event);
  }

  return events;
}

describe('the mistral stream', () => {
  it('opens, deltas, completes and ends', async () => {
    const events = await collect(
      streamOf([
        chunk({ role: 'assistant', content: 'Bon' }),
        chunk({ content: 'jour' }),
        chunk({}, 'stop', { usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      ]),
    );

    expect(events.map((event) => event.type())).toEqual([
      StreamEventType.StreamStart,
      StreamEventType.TextStart,
      StreamEventType.TextDelta,
      StreamEventType.TextDelta,
      StreamEventType.TextComplete,
      StreamEventType.StreamEnd,
    ]);
  });

  it('emits SEVERAL events from one chunk', async () => {
    // The first chunk both opens the stream and carries the first token.
    // Returning only the first event would drop tokens silently.
    const events = await collect(streamOf([chunk({ content: 'Hi' })]));

    expect(events).toHaveLength(3);
    expect(events[0]?.type()).toBe(StreamEventType.StreamStart);
    expect(events[2]?.type()).toBe(StreamEventType.TextDelta);
  });

  it('accumulates the full text for the completion event', async () => {
    const events = await collect(streamOf([chunk({ content: 'Bon' }), chunk({ content: 'jour' }), chunk({}, 'stop')]));
    const complete = events.find((event) => event.type() === StreamEventType.TextComplete);

    expect(complete).toBeInstanceOf(TextCompleteEvent);
    expect((complete as TextCompleteEvent).text).toBe('Bonjour');
  });

  it('stops at [DONE] rather than mapping it as a chunk', async () => {
    // It is not JSON. Parsing it yields an empty object, which the mapper would
    // read as a chunk with no choices.
    const events = await collect(streamOf([chunk({ content: 'x' }, 'stop')]));

    expect(events.filter((event) => event.type() === StreamEventType.StreamEnd)).toHaveLength(1);
  });

  it('reports null usage rather than zero when the provider sent none', async () => {
    // Zero tokens claims the generation was free.
    const events = await collect(streamOf([chunk({ content: 'x' }, 'stop')]));
    const end = events.at(-1) as StreamEndEvent;

    expect(end.usage).toBeNull();
    expect(end.finishReason).toBe(FinishReason.Stop);
  });

  it('reads usage off the LAST chunk, where Mistral puts it', async () => {
    const events = await collect(
      streamOf([chunk({ content: 'x' }), chunk({}, 'stop', { usage: { prompt_tokens: 11, completion_tokens: 4 } })]),
    );
    const end = events.at(-1) as StreamEndEvent;

    expect(end.usage?.promptTokens).toBe(11);
  });
});

describe('tool calls in a stream', () => {
  it('assembles arguments split across chunks and flushes at the end', () => {
    // Emitting a tool call while its JSON is still arriving hands a consumer a
    // fragment that will not parse.
    const mapper = new MistralStreamMapper();

    mapper.map(chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'weather', arguments: '{"ci' } }] }));
    mapper.map(chunk({ tool_calls: [{ index: 0, function: { arguments: 'ty":"Paris"}' } }] }));

    const events = mapper.map(chunk({}, 'tool_calls'));
    const call = events.find((event) => event instanceof ToolCallEvent) as ToolCallEvent;

    expect(call.toolCall.id).toBe('call_1');
    // The name arrives on the first fragment only; overwriting it with an empty
    // string on the second is how a tool call ends up nameless.
    expect(call.toolCall.name).toBe('weather');
    expect(call.toolCall.arguments).toBe('{"city":"Paris"}');
  });

  it('sends an empty object when a tool call carried no arguments', () => {
    const mapper = new MistralStreamMapper();

    mapper.map(chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'ping' } }] }));

    const events = mapper.map(chunk({}, 'tool_calls'));
    const call = events.find((event) => event instanceof ToolCallEvent) as ToolCallEvent;

    expect(call.toolCall.arguments).toBe('{}');
  });
});

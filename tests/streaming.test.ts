import { describe, expect, it } from 'vitest';
import {
  FinishReason,
  Prism,
  StreamEndEvent,
  StreamEventType,
  TextCompleteEvent,
  TextDeltaEvent,
  ToolCallEvent,
  sseData,
} from '../src/index.js';
import type { HttpRequest, HttpStreamResponse, HttpStreamTransport, StreamEvent } from '../src/index.js';

async function* fromChunks(chunks: readonly string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function streamTransport(chunks: readonly string[], status = 200): {
  transport: HttpStreamTransport;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];

  const transport: HttpStreamTransport = (request) => {
    calls.push(request);

    return Promise.resolve({ status, headers: {}, chunks: fromChunks(chunks) } as HttpStreamResponse);
  };

  return { transport, calls };
}

async function collect(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

const SSE = [
  'data: {"type":"response.created","response":{"model":"gpt-4o"}}\n\n',
  'data: {"type":"response.output_text.delta","delta":"Hel","item_id":"m1"}\n\n',
  'data: {"type":"response.output_text.delta","delta":"lo","item_id":"m1"}\n\n',
  'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":5,"output_tokens":2}}}\n\n',
  'data: [DONE]\n\n',
];

describe('SSE parsing', () => {
  it('reassembles a payload split across chunks', async () => {
    // THE reason the transport yields chunks rather than lines. A provider does
    // not align its writes to the reader's convenience, and this split lands
    // mid-JSON — the case a line-promising transport would have to handle
    // internally where no test could reach it.
    const payloads: string[] = [];

    for await (const payload of sseData(fromChunks(['data: {"type":"resp', 'onse.created"}\n\n']))) {
      payloads.push(payload);
    }

    expect(payloads).toEqual(['{"type":"response.created"}']);
  });

  it('drops the DONE sentinel rather than handing it on to be parsed', async () => {
    const payloads: string[] = [];

    for await (const payload of sseData(fromChunks(['data: [DONE]\n\n']))) {
      payloads.push(payload);
    }

    expect(payloads).toEqual([]);
  });

  it('keeps a final line that arrived with no trailing newline', async () => {
    // Dropping it loses the last event of any stream a server closes without one.
    const payloads: string[] = [];

    for await (const payload of sseData(fromChunks(['data: {"a":1}']))) {
      payloads.push(payload);
    }

    expect(payloads).toEqual(['{"a":1}']);
  });

  it('tolerates CRLF line endings', async () => {
    const payloads: string[] = [];

    for await (const payload of sseData(fromChunks(['data: {"a":1}\r\n\r\n']))) {
      payloads.push(payload);
    }

    expect(payloads).toEqual(['{"a":1}']);
  });
});

describe('streaming', () => {
  it('yields deltas and ends with a finish reason and usage', async () => {
    const { transport, calls } = streamTransport(SSE);

    const events = await collect(
      Prism.text().using('openai', 'gpt-4o', { apiKey: 'sk-test', streamTransport: transport }).withPrompt('Hi').asStream(),
    );

    const deltas = events.filter((event): event is TextDeltaEvent => event instanceof TextDeltaEvent);
    const end = events.at(-1);

    expect(deltas.map((delta) => delta.delta)).toEqual(['Hel', 'lo']);
    expect(end).toBeInstanceOf(StreamEndEvent);
    expect((end as StreamEndEvent).finishReason).toBe(FinishReason.Stop);
    expect((end as StreamEndEvent).usage?.promptTokens).toBe(5);

    // `stream: true` is added to the SAME body the non-streamed path sends, so
    // the two cannot drift into different requests that merely look alike.
    const sent = JSON.parse(calls[0]?.body ?? '{}');
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe('gpt-4o');
    expect(calls[0]?.headers.Accept).toBe('text/event-stream');
  });

  it('ignores an event type it does not recognise instead of failing the stream', async () => {
    // OpenAI adds event types without warning. A mapper that threw would turn a
    // provider's additive change into an outage for every consumer.
    const { transport } = streamTransport([
      'data: {"type":"response.created","response":{"model":"gpt-4o"}}\n\n',
      'data: {"type":"response.some_future_thing","payload":{}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hi","item_id":"m1"}\n\n',
    ]);

    const events = await collect(
      Prism.text().using('openai', 'gpt-4o', { apiKey: 'sk-test', streamTransport: transport }).withPrompt('Hi').asStream(),
    );

    expect(events.map((event) => event.type())).toEqual([
      StreamEventType.StreamStart,
      StreamEventType.TextDelta,
    ]);
  });

  it('reports a mid-stream provider error as an event, not an exception', async () => {
    // By the time this arrives the consumer has already rendered text. Throwing
    // would discard a partial answer the user watched appear.
    const { transport } = streamTransport([
      'data: {"type":"response.output_text.delta","delta":"Par","item_id":"m1"}\n\n',
      'data: {"type":"error","error":{"code":"rate_limit","message":"slow down"}}\n\n',
    ]);

    const events = await collect(
      Prism.text().using('openai', 'gpt-4o', { apiKey: 'sk-test', streamTransport: transport }).withPrompt('Hi').asStream(),
    );

    expect(events.map((event) => event.type())).toEqual([StreamEventType.TextDelta, StreamEventType.Error]);
  });

  it('reads an incomplete response as a length finish', async () => {
    const { transport } = streamTransport([
      'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
    ]);

    const events = await collect(
      Prism.text().using('openai', 'gpt-4o', { apiKey: 'sk-test', streamTransport: transport }).withPrompt('Hi').asStream(),
    );

    expect((events[0] as StreamEndEvent).finishReason).toBe(FinishReason.Length);
  });

  it('fails with the provider message when the stream never starts', async () => {
    const { transport } = streamTransport(['{"error":{"message":"bad key"}}'], 401);

    await expect(
      collect(
        Prism.text()
          .using('openai', 'gpt-4o', { apiKey: 'sk-test', streamTransport: transport })
          .withPrompt('Hi')
          .asStream(),
      ),
    ).rejects.toThrowError(/bad key/);
  });
});

const ANTHROPIC_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-5","usage":{"input_tokens":7,"output_tokens":0}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'data: {"type":"ping"}\n\n',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n',
  'data: {"type":"content_block_stop","index":0}\n\n',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
  'data: {"type":"message_stop"}\n\n',
];

describe('Anthropic streaming', () => {
  it('accumulates deltas and completes with the text it actually saw', async () => {
    const { transport } = streamTransport(ANTHROPIC_SSE);

    const events = await collect(
      Prism.text()
        .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', streamTransport: transport })
        .withPrompt('Hi')
        .asStream(),
    );

    const types = events.map((event) => event.type());
    const complete = events.find((event) => event instanceof TextCompleteEvent);
    const end = events.at(-1) as StreamEndEvent;

    // `ping` produces nothing a consumer can use and is dropped rather than
    // surfaced as noise.
    expect(types).toEqual([
      StreamEventType.StreamStart,
      StreamEventType.TextStart,
      StreamEventType.TextDelta,
      StreamEventType.TextDelta,
      StreamEventType.TextComplete,
      StreamEventType.StreamEnd,
    ]);

    // Truthful because it was accumulated: `content_block_stop` carries no text
    // of its own, so without the mapper's memory this would be empty.
    expect((complete as TextCompleteEvent).text).toBe('Hello');
    expect(end.finishReason).toBe(FinishReason.Stop);
    // Anthropic reports output tokens cumulatively on message_delta, so the
    // last one wins rather than summing.
    expect(end.usage?.completionTokens).toBe(4);
    expect(end.usage?.promptTokens).toBe(7);
  });

  it('emits a tool call once its arguments have finished arriving', async () => {
    // A half-parsed JSON fragment is not something a consumer can use, so the
    // partials accumulate and only the finished call is emitted.
    const { transport } = streamTransport([
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-5"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"lookup"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"ada\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);

    const events = await collect(
      Prism.text()
        .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', streamTransport: transport })
        .withPrompt('Hi')
        .asStream(),
    );

    const call = events.find((event) => event instanceof ToolCallEvent) as ToolCallEvent;

    expect(call.toolCall.name).toBe('lookup');
    expect(call.toolCall.parsedArguments()).toEqual({ q: 'ada' });
    // The tool block opening emitted nothing: a tool call is only meaningful
    // once its arguments exist.
    expect(events.filter((event) => event.type() === StreamEventType.TextStart)).toHaveLength(0);
  });

  it('gives each stream its own mapper', async () => {
    // The mapper carries a message id and accumulated text. A shared instance
    // would let two concurrent generations read each other's blocks — a bug
    // that only appears under load and looks like the model hallucinating.
    const first = streamTransport(ANTHROPIC_SSE);
    const second = streamTransport(ANTHROPIC_SSE);

    const [a, b] = await Promise.all([
      collect(
        Prism.text()
          .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', streamTransport: first.transport })
          .withPrompt('Hi')
          .asStream(),
      ),
      collect(
        Prism.text()
          .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', streamTransport: second.transport })
          .withPrompt('Hi')
          .asStream(),
      ),
    ]);

    const textOf = (events: StreamEvent[]): string =>
      (events.find((event) => event instanceof TextCompleteEvent) as TextCompleteEvent).text;

    expect(textOf(a)).toBe('Hello');
    expect(textOf(b)).toBe('Hello');
  });

  it('reads max_tokens as a length finish', async () => {
    const { transport } = streamTransport([
      'data: {"type":"message_start","message":{"id":"m","model":"claude-sonnet-4-5"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);

    const events = await collect(
      Prism.text()
        .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', streamTransport: transport })
        .withPrompt('Hi')
        .asStream(),
    );

    expect((events.at(-1) as StreamEndEvent).finishReason).toBe(FinishReason.Length);
  });
});

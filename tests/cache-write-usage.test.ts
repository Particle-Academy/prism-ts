import { expect, it } from 'vitest';
import { ObjectSchema, Prism, StringSchema, Usage } from '../src/index.js';
import type { HttpTransport, JsonObject } from '../src/index.js';
import { AnthropicStreamMapper } from '../src/providers/anthropic/stream-events.js';
import { StreamEndEvent } from '../src/streaming/events.js';

const lifetimes: [string, number | null, number | null][] = [
  ['5m', 148, 0], ['1h', 0, 100], ['both', 148, 100], ['zero', 0, 0], ['absent', null, null],
];

function reported(five: number | null, hour: number | null): JsonObject {
  return {
    input_tokens: 2048, output_tokens: 503, cache_creation_input_tokens: five === null ? 248 : five + (hour ?? 0),
    cache_read_input_tokens: 1800,
    ...(five === null ? {} : { cache_creation: { ephemeral_5m_input_tokens: five, ephemeral_1h_input_tokens: hour } }),
  };
}

function assertUsage(usage: Usage | null, five: number | null, hour: number | null): void {
  expect(usage).not.toBeNull();
  expect(usage?.cacheWrite5mInputTokens).toBe(five);
  expect(usage?.cacheWrite1hInputTokens).toBe(hour);
  expect(usage?.cacheWriteInputTokens).toBe(five === null ? 248 : five + (hour ?? 0));
  expect(usage?.promptTokens).toBe(2048);
  expect(usage?.completionTokens).toBe(503);
  expect(usage?.cacheReadInputTokens).toBe(1800);
  expect(Usage.fromObject(usage!.toObject()).toObject()).toEqual(usage?.toObject());
  if (five !== null && hour !== null) {
    expect(usage?.cacheWriteInputTokens).toBe(usage!.cacheWrite5mInputTokens! + usage!.cacheWrite1hInputTokens!);
  }
}

for (const [name, five, hour] of lifetimes) {
  for (const mode of ['text', 'structured']) {
    it(`preserves ${name} cache writes through ${mode}`, async () => {
      const body = { id: 'msg_cache', model: 'claude-owned-fixture', role: 'assistant', type: 'message',
        content: [{ type: 'text', text: '{"value":"ok"}' }], stop_reason: 'end_turn', usage: reported(five, hour) };
      const transport: HttpTransport = () => Promise.resolve({ status: 200, headers: {}, body, rawBody: JSON.stringify(body) });
      const config = { apiKey: 'owned-test-value', transport };
      const response = mode === 'text'
        ? await Prism.text().using('anthropic', 'claude-owned-fixture', config).withPrompt('Owned fixture').asText()
        : await Prism.structured().using('anthropic', 'claude-owned-fixture', config)
          .withSchema(new ObjectSchema('result', 'Result', [new StringSchema('value', 'Value')], { requiredFields: ['value'] }))
          .withPrompt('Owned fixture').asStructured();
      assertUsage(response.usage, five, hour);
      assertUsage(response.steps[0]!.usage, five, hour);
    });
  }
  for (const atEnd of [false, true]) {
    it(`preserves ${name} cache writes with cumulative/sparse deltas (late=${String(atEnd)})`, () => {
      const mapper = new AnthropicStreamMapper();
      const raw = reported(five, hour);
      const replaceZero = !atEnd && five === 0 && hour === 0;
      const restated = atEnd || replaceZero;
      mapper.map({ type: 'message_start', message: { id: 'msg_cache', model: 'claude-owned-fixture',
        usage: atEnd ? { input_tokens: 0, output_tokens: 0 } : { ...(replaceZero ? reported(148, 100) : raw), output_tokens: 0 } } });
      mapper.map({ type: 'message_delta', delta: {}, usage: restated ? { ...raw, output_tokens: 100 } : { output_tokens: 100 } });
      mapper.map({ type: 'message_delta', delta: {}, usage: restated ? raw : { output_tokens: 503 } });
      mapper.map({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 503 } });
      mapper.map({ type: 'message_stop' });
      const end = mapper.finish().find((event) => event instanceof StreamEndEvent);
      assertUsage(end?.usage ?? null, five, hour);
    });
  }
}

it('keeps legacy positional construction and absent serialized fields nullable', () => {
  const usage = new Usage(11, 23, 5, 7, 3, 0.02);
  expect(usage.cost).toBe(0.02);
  expect(usage.cacheWrite5mInputTokens).toBeNull();
  expect(usage.cacheWrite1hInputTokens).toBeNull();
  expect(Usage.fromObject({ prompt_tokens: 11, completion_tokens: 23 }).cacheWrite1hInputTokens).toBeNull();
});

it('does not retain an earlier lifetime split after a changed write total without a split', () => {
  const mapper = new AnthropicStreamMapper();
  mapper.map({ type: 'message_start', message: { id: 'msg_cache', model: 'claude-owned-fixture', usage: { ...reported(148, 100), output_tokens: 0 } } });
  mapper.map({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 503, cache_creation_input_tokens: 100 } });
  mapper.map({ type: 'message_stop' });
  const usage = mapper.finish().find((event) => event instanceof StreamEndEvent)?.usage;
  expect(usage?.cacheWriteInputTokens).toBe(100);
  expect(usage?.cacheWrite5mInputTokens).toBeNull();
  expect(usage?.cacheWrite1hInputTokens).toBeNull();
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErrorEvent, Prism, PrismError, StreamFailureUsage, Usage } from '../src/index.js';
import type { HttpStreamTransport, StreamEvent } from '../src/index.js';

const legacy: Record<string, unknown> = JSON.parse(readFileSync(new URL('./fixtures/stream-failure-legacy.json', import.meta.url), 'utf8'));
const providers = ['anthropic', 'openai', 'mistral'] as const;
type Provider = typeof providers[number];

function fixture(provider: Provider, reported: boolean): string {
  const usage = reported ? (provider === 'anthropic' ? { input_tokens: 11, output_tokens: 0 } :
    provider === 'openai' ? { input_tokens: 11, output_tokens: 0 } : { prompt_tokens: 11, completion_tokens: 0 }) : undefined;
  const event = provider === 'anthropic' ? { type: 'message_start', message: { id: 'owned', model: 'owned', usage } } :
    provider === 'openai' ? { type: 'response.created', response: { model: 'owned', usage } } :
      { id: 'owned', model: 'owned', usage, choices: [{ delta: { content: 'owned' } }] };
  return `data: ${JSON.stringify(event)}\n\n`;
}

function native(provider: Provider, reported: boolean, failure?: Error, malformed = false) {
  const state = { closed: false };
  const streamTransport: HttpStreamTransport = () => Promise.resolve({ status: 200, headers: {}, chunks: (async function* () {
    try {
      yield fixture(provider, reported);
      if (malformed) yield 'data: {broken\n\n';
      if (failure) throw failure;
    } finally { state.closed = true; }
  })() });
  const stream = Prism.text().using(provider, 'owned', { apiKey: '', streamTransport }).withPrompt('owned').asStream();
  return { stream, state };
}

describe('immutable failure reports and public legacy error compatibility', () => {
  it('retains the exact published 0.7 event and exception bytes with no report', () => {
    const event = new ErrorEvent('owned_code', 'owned-message', 'owned-event', 0, false);
    const cause = new Error('owned-cause');
    const error = new PrismError('provider_response_error', 'owned-message', { httpStatus: 429, responseBody: 'owned-body', cause });
    expect(event.toObject()).toEqual(legacy.error_event_object);
    expect(JSON.stringify(event)).toBe(legacy.error_event_json);
    expect(JSON.stringify(error)).toBe(legacy.sdk_error_json);
    expect({ class_name: error.constructor.name, name: error.name, code: error.code, message: error.message,
      httpStatus: error.httpStatus, responseBody: error.responseBody }).toEqual(legacy.sdk_error_fields);
    expect(error.cause === cause).toBe(legacy.cause_preserved);
    expect(error.streamFailureUsage()).toBeNull();
    expect(event.failureUsage).toBeNull();
    const report = new StreamFailureUsage(new Usage(0, 0, null, null, null, 0), 0, ['prompt_tokens', 'completion_tokens', 'cost']);
    expect(error.withStreamFailureUsage(report)).toBe(error);
    expect(JSON.parse(JSON.stringify(error)).failure_usage.usage.cost).toBe(0);
    error.withStreamFailureUsage(null);
    expect(JSON.stringify(error)).toBe(legacy.sdk_error_json);
  });

  it('copies input aliases and exposes fresh serialized maps with explicit zeros', () => {
    const usage = new Usage(0, 0, null, null, null, 0);
    const mask = ['prompt_tokens', 'completion_tokens', 'cost'];
    const report = new StreamFailureUsage(usage, 2, mask);
    Reflect.set(usage, 'promptTokens', 99);
    mask.push('thought_tokens');
    expect(Reflect.set(report.usage, 'promptTokens', 99)).toBe(false);
    expect(Reflect.set(report, 'stepIndex', 99)).toBe(false);
    expect(Reflect.set(report.reportedFields, '0', 'cost')).toBe(false);
    const serialized = report.toObject();
    serialized.usage = null;
    serialized.reported_fields = [];
    expect(report.usage.promptTokens).toBe(0);
    expect(report.usage.cost).toBe(0);
    expect(report.reportedFields).toEqual(['prompt_tokens', 'completion_tokens', 'cost']);
    expect(report.toObject()).toMatchObject({ step_index: 2, status: 'provisional', scope: 'attempt', includes_completed_steps: false,
      usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 } });
  });

  it.each([[], ['prompt_tokens', 'prompt_tokens'], ['not_usage']].map(mask => ({ mask })))('rejects invalid report mask $mask', ({ mask }) => {
    expect(() => new StreamFailureUsage(new Usage(0, 0), 0, mask)).toThrow(TypeError);
  });
  it.each([-1, 0.5, NaN])('rejects invalid step %s', step => {
    expect(() => new StreamFailureUsage(new Usage(0, 0), step, ['prompt_tokens'])).toThrow(TypeError);
  });
  it('keeps the report mask closed when a Usage subclass customizes its serializer', () => {
    class ExtendedUsage extends Usage {
      override toObject() { return { ...super.toObject(), private_field: 1 }; }
    }
    expect(() => new StreamFailureUsage(new ExtendedUsage(0, 0), 0, ['private_field'])).toThrow(TypeError);
  });
});

describe.each(providers)('%s native failure channel', provider => {
  it.each([false, true])('preserves the exact foreign read exception (reported=%s)', async reported => {
    const failure = new Error('owned-foreign');
    const { stream } = native(provider, reported, failure);
    const events: StreamEvent[] = [];
    let caught: unknown;
    try { for await (const event of stream) events.push(event); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    const errors = events.filter((event): event is ErrorEvent => event instanceof ErrorEvent);
    expect(errors).toHaveLength(reported ? 1 : 0);
    if (reported) expect(errors[0]!.failureUsage!.usage.promptTokens).toBe(11);
  });

  it('adds the accessor to the original SDK read exception without an extra event', async () => {
    const cause = new Error('owned-cause');
    const failure = new PrismError('provider_response_error', 'owned-sdk', { httpStatus: 503, cause });
    const { stream } = native(provider, true, failure);
    const events: StreamEvent[] = [];
    let caught: unknown;
    try { for await (const event of stream) events.push(event); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(failure.cause).toBe(cause);
    expect(failure.httpStatus).toBe(503);
    expect(failure.streamFailureUsage()!.usage.promptTokens).toBe(11);
    expect(events.filter(event => event instanceof ErrorEvent)).toHaveLength(0);
  });

  it.each([false, true])('makes malformed JSON observable once (reported=%s)', async reported => {
    const events = [];
    for await (const event of native(provider, reported, undefined, true).stream) events.push(event);
    const errors = events.filter((event): event is ErrorEvent => event instanceof ErrorEvent);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('stream_decode_error');
    expect(errors[0]!.failureUsage !== null).toBe(reported);
    const ends = events.filter(event => event.type() === 'stream_end');
    expect(ends).toHaveLength(provider === 'anthropic' ? 1 : 0);
  });

  it('does not classify a consumer throw as a provider failure', async () => {
    const { stream, state } = native(provider, true);
    await stream.next();
    const user = new PrismError('provider_response_error', 'owned-user');
    await expect(stream.throw(user)).rejects.toBe(user);
    expect(user.streamFailureUsage()).toBeNull();
    expect(state.closed).toBe(true);
  });

  it('closes the underlying iterator on consumer return', async () => {
    const { stream, state } = native(provider, true);
    await stream.next();
    await stream.return(undefined);
    expect(state.closed).toBe(true);
  });
});

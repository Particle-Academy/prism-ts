import { isJsonObject, type JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import { Usage } from '../value-objects/usage.js';
import { StreamFailureUsage } from '../value-objects/stream-failure-usage.js';
import { ErrorEvent } from './events.js';

type Provider = 'anthropic' | 'openai' | 'mistral';
const fields = ['prompt_tokens', 'completion_tokens', 'cache_write_input_tokens',
  'cache_read_input_tokens', 'thought_tokens', 'cost', 'cache_write_5m_input_tokens',
  'cache_write_1h_input_tokens'] as const;
type Field = typeof fields[number];

/** @internal State belongs to one request, not to a reused provider or completed steps. */
export class StreamFailureUsageTracker {
  readonly #reported: Partial<Record<Field, number>> = {};

  constructor(readonly provider: Provider, readonly stepIndex = 0) {}

  record(data: JsonObject): void {
    let value: unknown = data.usage;
    const nested = this.provider === 'anthropic' ? data.message : this.provider === 'openai' ? data.response : null;
    if (isJsonObject(nested) && Object.hasOwn(nested, 'usage')) value = nested.usage;
    if (!isJsonObject(value)) return;
    const raw = value;
    const total = raw.cache_creation_input_tokens;
    if (this.provider === 'anthropic' && Number.isSafeInteger(total)
        && this.#reported.cache_write_input_tokens !== undefined
        && total !== this.#reported.cache_write_input_tokens) {
      delete this.#reported.cache_write_5m_input_tokens;
      delete this.#reported.cache_write_1h_input_tokens;
    }
    const paths: Partial<Record<Field, string>> = this.provider === 'anthropic' ? {
      prompt_tokens: 'input_tokens', completion_tokens: 'output_tokens',
      cache_write_input_tokens: 'cache_creation_input_tokens', cache_read_input_tokens: 'cache_read_input_tokens',
      thought_tokens: 'output_tokens_details.thinking_tokens',
      cache_write_5m_input_tokens: 'cache_creation.ephemeral_5m_input_tokens',
      cache_write_1h_input_tokens: 'cache_creation.ephemeral_1h_input_tokens',
    } : {
      prompt_tokens: Object.hasOwn(raw, 'input_tokens') ? 'input_tokens' : 'prompt_tokens',
      completion_tokens: Object.hasOwn(raw, 'output_tokens') ? 'output_tokens' : 'completion_tokens',
      cache_read_input_tokens: Object.hasOwn(raw, 'input_tokens') ? 'input_tokens_details.cached_tokens' : 'prompt_tokens_details.cached_tokens',
      cache_write_input_tokens: 'input_tokens_details.cache_write_tokens',
      thought_tokens: Object.hasOwn(raw, 'output_tokens') ? 'output_tokens_details.reasoning_tokens' : 'completion_tokens_details.reasoning_tokens',
    };
    for (const field of fields) {
      const key = paths[field];
      if (key === undefined) continue;
      const count = at(raw, key);
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
        this.#reported[field] = count;
      }
    }
  }

  snapshot(): StreamFailureUsage | null {
    const r = this.#reported;
    const reported = fields.filter(field => r[field] !== undefined);
    if (reported.length === 0) return null;
    let prompt = r.prompt_tokens ?? 0;
    if (this.provider !== 'anthropic') prompt = Math.max(0, prompt - (r.cache_read_input_tokens ?? 0));
    if (this.provider === 'openai') prompt = Math.max(0, prompt - (r.cache_write_input_tokens ?? 0));
    return new StreamFailureUsage(new Usage(prompt, r.completion_tokens ?? 0,
      r.cache_write_input_tokens ?? null, r.cache_read_input_tokens ?? null,
      r.thought_tokens ?? null, null, r.cache_write_5m_input_tokens ?? null,
      r.cache_write_1h_input_tokens ?? null), this.stepIndex, reported);
  }
}

function at(raw: JsonObject, key: string): unknown {
  let value: unknown = raw;
  for (const part of key.split('.')) {
    if (!isJsonObject(value)) return undefined;
    value = value[part];
  }
  return value;
}

/** Only next() is caught. A consumer throw at yield must retain its native behavior. */
export async function* failureAwareSse(
  source: AsyncIterable<string>, snapshot: () => StreamFailureUsage | null,
): AsyncGenerator<string | ErrorEvent, void, unknown> {
  const iterator = source[Symbol.asyncIterator]();
  let done = false;
  try {
    while (true) {
      let next: IteratorResult<string> | undefined;
      let failed = false;
      let failure: unknown;
      try { next = await iterator.next(); } catch (error) { failed = true; failure = error; }
      if (failed) {
        done = true;
        const usage = snapshot();
        if (failure instanceof PrismError) failure.withStreamFailureUsage(usage);
        else if (usage !== null) yield new ErrorEvent('stream_transport_error', 'The stream failed.', undefined, undefined, false, usage);
        throw failure;
      }
      if (next === undefined || next.done) { done = true; return; }
      yield next.value;
    }
  } finally {
    if (!done) await iterator.return?.();
  }
}

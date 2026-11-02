import type { JsonObject } from '../json.js';
import { readNullableNumber, readNumber } from '../internal/filters.js';

export class Usage {
  constructor(
    readonly promptTokens: number,
    readonly completionTokens: number,
    readonly cacheWriteInputTokens: number | null = null,
    readonly cacheReadInputTokens: number | null = null,
    readonly thoughtTokens: number | null = null,
    readonly cost: number | null = null,
    /** Cache writes with a 5-minute TTL; Anthropic bills 1.25x base input price. */
    readonly cacheWrite5mInputTokens: number | null = null,
    /** Cache writes with a 1-hour TTL; Anthropic bills 2x base input price. */
    readonly cacheWrite1hInputTokens: number | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      prompt_tokens: this.promptTokens,
      completion_tokens: this.completionTokens,
      cache_write_input_tokens: this.cacheWriteInputTokens,
      cache_read_input_tokens: this.cacheReadInputTokens,
      thought_tokens: this.thoughtTokens,
      cost: this.cost,
      cache_write_5m_input_tokens: this.cacheWrite5mInputTokens,
      cache_write_1h_input_tokens: this.cacheWrite1hInputTokens,
    };
  }

  static fromObject(object: JsonObject): Usage {
    return new Usage(
      readNumber(object.prompt_tokens, 0),
      readNumber(object.completion_tokens, 0),
      readNullableNumber(object.cache_write_input_tokens),
      readNullableNumber(object.cache_read_input_tokens),
      readNullableNumber(object.thought_tokens),
      readNullableNumber(object.cost),
      readNullableNumber(object.cache_write_5m_input_tokens),
      readNullableNumber(object.cache_write_1h_input_tokens),
    );
  }
}

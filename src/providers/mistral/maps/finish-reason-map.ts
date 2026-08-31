import type { JsonObject } from '../../../json.js';
import { FinishReason } from '../../../enums.js';
import { isJsonObject } from '../../../json.js';
import { readArray, readString } from '../../../internal/filters.js';

/**
 * Map Mistral's `finish_reason` onto the shared enum.
 *
 * It sits on the CHOICE, not the top-level payload, which is where the
 * chat-completions shape differs from both of this package's other providers —
 * reading it off the root returns undefined and every generation reports
 * Unknown.
 *
 * An unrecognised reason becomes Unknown rather than Stop. Guessing Stop would
 * present a truncated or filtered generation as a complete one.
 */
export function mapFinishReason(data: JsonObject): FinishReason {
  const first = readArray(data.choices)[0];
  const reason = isJsonObject(first) ? readString(first.finish_reason, '') : '';

  switch (reason) {
    case 'stop':
      return FinishReason.Stop;
    case 'tool_calls':
      return FinishReason.ToolCalls;
    case 'length':
    case 'model_length':
      return FinishReason.Length;
    case 'content_filter':
      return FinishReason.ContentFilter;
    default:
      return FinishReason.Unknown;
  }
}

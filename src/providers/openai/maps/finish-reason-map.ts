import type { JsonObject } from '../../../json.js';
import { isJsonObject } from '../../../json.js';
import { readString } from '../../../internal/filters.js';
import { FinishReason } from '../../../enums.js';

/**
 * The LAST item of `output`, or `null` when there isn't one.
 *
 * The reference reads `output.{last}`, which means exactly this. An empty
 * `output` array yields nothing at all rather than an error — worth stating,
 * because "the last element of an empty list" is where a port can quietly
 * produce `undefined` and map it to the wrong finish reason.
 */
export function lastOutputItem(data: JsonObject): JsonObject | null {
  const output = data.output;

  if (!Array.isArray(output) || output.length === 0) {
    return null;
  }

  const last = output.at(-1);

  return isJsonObject(last) ? last : null;
}

/** Map an output item's status and type onto a finish reason. */
export function mapFinishReasonFromOutput(status: string, type: string): FinishReason {
  switch (status) {
    case 'incomplete':
    case 'length':
      return FinishReason.Length;
    case 'failed':
      return FinishReason.Error;
    case 'completed':
      if (type === 'function_call') {
        return FinishReason.ToolCalls;
      }

      if (type === 'message') {
        return FinishReason.Stop;
      }

      // Every provider-native tool ends in `_call`, so an unrecognised
      // `*_call` type is still a tool call rather than an unknown finish.
      return type.endsWith('_call') ? FinishReason.ToolCalls : FinishReason.Unknown;
    default:
      return FinishReason.Unknown;
  }
}

/**
 * Map a whole response payload onto a finish reason.
 *
 * A TOP-LEVEL `incomplete` status wins over anything the output items say,
 * because it is the response as a whole that was cut short.
 */
export function mapFinishReason(data: JsonObject): FinishReason {
  if (readString(data.status, '') === 'incomplete') {
    const details = isJsonObject(data.incomplete_details) ? data.incomplete_details : {};

    return details.reason === 'content_filter' ? FinishReason.ContentFilter : FinishReason.Length;
  }

  const last = lastOutputItem(data) ?? {};

  return mapFinishReasonFromOutput(readString(last.status, ''), readString(last.type, ''));
}

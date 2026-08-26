import type { JsonObject } from '../../../json.js';
import { FinishReason } from '../../../enums.js';
import { readString } from '../../../internal/filters.js';

/**
 * Map Anthropic's `stop_reason` onto the shared enum.
 *
 * `end_turn` and `stop_sequence` both mean the model chose to stop, so both
 * collapse to Stop — the distinction is about HOW it stopped, which the raw
 * payload still carries for anyone who needs it.
 *
 * An unrecognised reason becomes Unknown rather than Stop. Guessing Stop would
 * present a truncated or refused generation as a complete one.
 */
export function mapFinishReason(data: JsonObject): FinishReason {
  switch (readString(data.stop_reason, '')) {
    case 'end_turn':
    case 'stop_sequence':
      return FinishReason.Stop;
    case 'tool_use':
      return FinishReason.ToolCalls;
    case 'max_tokens':
      return FinishReason.Length;
    case 'pause_turn':
      return FinishReason.Pause;
    case 'refusal':
      return FinishReason.Refusal;
    default:
      return FinishReason.Unknown;
  }
}

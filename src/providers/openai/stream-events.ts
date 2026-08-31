import { isJsonObject, type JsonObject } from '../../json.js';
import { finishReasonFromValue, FinishReason } from '../../enums.js';
import { ToolCall } from '../../value-objects/tool-call.js';
import { Usage } from '../../value-objects/usage.js';
import type {
  StreamEvent} from '../../streaming/events.js';
import {
  ErrorEvent,
  StreamEndEvent,
  StreamStartEvent,
  TextCompleteEvent,
  TextDeltaEvent,
  TextStartEvent,
  ToolCallEvent,
} from '../../streaming/events.js';

/**
 * Map one OpenAI Responses SSE payload to zero or one port events.
 *
 * RETURNS NULL FOR ANYTHING IT DOES NOT RECOGNISE, on purpose. OpenAI adds
 * event types without warning, and a mapper that threw on an unknown `type`
 * would turn a provider's additive change into an outage for every consumer.
 * A stream that silently ignores an event it cannot use still delivers the
 * text; one that throws delivers nothing.
 */
export function mapStreamEvent(payload: JsonObject): StreamEvent | null {
  const type = typeof payload.type === 'string' ? payload.type : '';

  switch (type) {
    case 'response.created':
      return new StreamStartEvent(readModel(payload));

    case 'response.output_item.added':
      return new TextStartEvent(readString(payload.item_id) || readString(payload.id));

    case 'response.output_text.delta':
      return new TextDeltaEvent(readString(payload.delta), readString(payload.item_id));

    case 'response.output_text.done':
      return new TextCompleteEvent(readString(payload.text), readString(payload.item_id));

    case 'response.output_item.done':
      return toolCallEvent(payload);

    case 'error':
    case 'response.failed':
      return new ErrorEvent(
        readString(readObject(payload.error)?.code) || 'unknown_error',
        readString(readObject(payload.error)?.message) || 'The provider reported an error mid-stream.',
      );

    case 'response.completed':
    case 'response.incomplete':
      return new StreamEndEvent(finishReason(payload), usage(payload));

    default:
      return null;
  }
}

function toolCallEvent(payload: JsonObject): StreamEvent | null {
  const item = readObject(payload.item);

  // Only function calls become tool-call events. `output_item.done` also closes
  // ordinary message items, and treating those as tool calls would invent one
  // per assistant turn.
  if (item === null || item.type !== 'function_call') {
    return null;
  }

  return new ToolCallEvent(
    new ToolCall(readString(item.call_id) || readString(item.id), readString(item.name), readString(item.arguments)),
    readString(payload.item_id) || readString(item.id),
  );
}

function finishReason(payload: JsonObject): FinishReason {
  const response = readObject(payload.response);
  const incomplete = readObject(response?.incomplete_details);

  // `incomplete` carries its own reason; the response status does not say why.
  if (incomplete !== null && readString(incomplete.reason) === 'max_output_tokens') {
    return FinishReason.Length;
  }

  return response === null ? FinishReason.Stop : finishReasonFromValue(mapStatus(readString(response.status)));
}

function mapStatus(status: string): string {
  return status === 'completed' ? 'stop' : status === 'incomplete' ? 'length' : 'unknown';
}

function usage(payload: JsonObject): Usage | null {
  const raw = readObject(readObject(payload.response)?.usage);

  if (raw === null) {
    return null;
  }

  return new Usage(readNumber(raw.input_tokens), readNumber(raw.output_tokens));
}

function readModel(payload: JsonObject): string {
  return readString(readObject(payload.response)?.model) || readString(payload.model);
}

function readObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

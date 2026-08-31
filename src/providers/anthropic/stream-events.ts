import { isJsonObject, type JsonObject } from '../../json.js';
import { FinishReason } from '../../enums.js';
import { ToolCall } from '../../value-objects/tool-call.js';
import { Usage } from '../../value-objects/usage.js';
import {
  ErrorEvent,
  StreamEndEvent,
  type StreamEvent,
  StreamStartEvent,
  TextCompleteEvent,
  TextDeltaEvent,
  TextStartEvent,
  ToolCallEvent,
} from '../../streaming/events.js';
import { mapFinishReason } from './maps/finish-reason-map.js';

/**
 * Anthropic's stream, which needs MEMORY where OpenAI's does not.
 *
 * OpenAI repeats the identifiers on every event, so a payload can be mapped on
 * its own and the mapper is a pure function. Anthropic does not: a
 * `content_block_delta` carries only an INDEX, the message id arrived back at
 * `message_start`, the stop reason arrives at `message_delta` and the stream
 * ends at `message_stop`. Mapping one payload in isolation is impossible.
 *
 * So this is a class with state, and that difference is the provider's, not a
 * design choice worth hiding. The alternative — emitting events with empty ids,
 * or an end event with no reason — would keep the shape uniform by making the
 * contents wrong.
 */
export class AnthropicStreamMapper {
  #messageId = '';

  #stopReason: JsonObject = {};

  #usage: Usage | null = null;

  /** Accumulated text and tool JSON, per content-block index. */
  readonly #blocks = new Map<number, { type: string; text: string; id: string; name: string }>();

  /**
   * Zero or one event for this payload.
   *
   * `ping` and `content_block_start` for a text block produce nothing a
   * consumer can use; they are dropped rather than surfaced as noise.
   */
  map(payload: JsonObject): StreamEvent | null {
    switch (readString(payload.type)) {
      case 'message_start':
        return this.#messageStart(payload);

      case 'content_block_start':
        return this.#blockStart(payload);

      case 'content_block_delta':
        return this.#blockDelta(payload);

      case 'content_block_stop':
        return this.#blockStop(payload);

      case 'message_delta':
        this.#messageDelta(payload);

        return null;

      case 'message_stop':
        return new StreamEndEvent(this.#finishReason(), this.#usage);

      case 'error':
        return new ErrorEvent(
          readString(readObject(payload.error)?.type) || 'unknown_error',
          readString(readObject(payload.error)?.message) || 'The provider reported an error mid-stream.',
        );

      default:
        // `ping`, and anything Anthropic adds later. Ignored rather than fatal,
        // for the same reason the OpenAI mapper ignores what it does not know:
        // a provider's additive change must not become an outage.
        return null;
    }
  }

  #messageStart(payload: JsonObject): StreamEvent {
    const message = readObject(payload.message);

    this.#messageId = readString(message?.id);
    this.#usage = usage(readObject(message?.usage));

    return new StreamStartEvent(readString(message?.model));
  }

  #blockStart(payload: JsonObject): StreamEvent | null {
    const index = readNumber(payload.index);
    const block = readObject(payload.content_block);
    const type = readString(block?.type);

    this.#blocks.set(index, {
      type,
      text: '',
      id: readString(block?.id),
      name: readString(block?.name),
    });

    // A text block opening is worth announcing; a tool block opening is not,
    // because the tool call is only meaningful once its arguments have arrived.
    return type === 'text' ? new TextStartEvent(this.#messageId) : null;
  }

  #blockDelta(payload: JsonObject): StreamEvent | null {
    const index = readNumber(payload.index);
    const delta = readObject(payload.delta);
    const block = this.#blocks.get(index);

    if (block === undefined || delta === null) {
      return null;
    }

    // Text and tool arguments arrive through the same event with different
    // delta types. Both accumulate; only text is worth emitting per chunk,
    // because a half-parsed JSON fragment is not something a consumer can use.
    if (readString(delta.type) === 'text_delta') {
      const text = readString(delta.text);
      block.text += text;

      return new TextDeltaEvent(text, this.#messageId);
    }

    if (readString(delta.type) === 'input_json_delta') {
      block.text += readString(delta.partial_json);
    }

    return null;
  }

  #blockStop(payload: JsonObject): StreamEvent | null {
    const block = this.#blocks.get(readNumber(payload.index));

    if (block === undefined) {
      return null;
    }

    // Truthful because it was accumulated. Anthropic's `content_block_stop`
    // carries no text of its own, so emitting a complete event without the
    // memory above would mean emitting an empty one.
    return block.type === 'text'
      ? new TextCompleteEvent(block.text, this.#messageId)
      : new ToolCallEvent(new ToolCall(block.id, block.name, block.text), this.#messageId);
  }

  #messageDelta(payload: JsonObject): void {
    const delta = readObject(payload.delta);

    if (delta !== null) {
      this.#stopReason = delta;
    }

    // Anthropic reports output tokens here rather than at message_stop, and
    // reports them CUMULATIVELY, so the last one wins rather than summing.
    const tokens = readObject(payload.usage);

    if (tokens !== null) {
      this.#usage = new Usage(this.#usage?.promptTokens ?? 0, readNumber(tokens.output_tokens));
    }
  }

  #finishReason(): FinishReason {
    return this.#stopReason.stop_reason === undefined ? FinishReason.Stop : mapFinishReason(this.#stopReason);
  }
}

function usage(raw: JsonObject | null): Usage | null {
  return raw === null ? null : new Usage(readNumber(raw.input_tokens), readNumber(raw.output_tokens));
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

import { isJsonObject, type JsonObject } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import { FinishReason } from '../../../enums.js';
import { readArray, readNumber, readObject, readString } from '../../../internal/filters.js';
import {
  ErrorEvent,
  StreamEndEvent,
  type StreamEvent,
  StreamStartEvent,
  TextCompleteEvent,
  TextDeltaEvent,
  TextStartEvent,
  ToolCallEvent,
} from '../../../streaming/events.js';
import { StreamFailureUsageTracker } from '../../../streaming/failure-usage.js';
import type { StreamFailureUsage } from '../../../value-objects/stream-failure-usage.js';
import { ToolCall } from '../../../value-objects/tool-call.js';
import type { Usage } from '../../../value-objects/usage.js';
import { mapChatFinishReason } from './maps.js';
import { chatUsage } from './parse-response.js';

/**
 * The OpenAI chat-completions stream, after the reference's
 * `ChatCompletions\Stream` handler.
 *
 * One instance per stream: it holds the text so far, the tool-call fragments
 * keyed by index, and any refusal fragments.
 *
 * What it does NOT do is the reference's tool loop. A reply that finishes on
 * tool calls emits each call once, whole, and ends the stream with
 * `FinishReason.ToolCalls`; no tool runs and no second request is sent, as on
 * every other stream in this port (G-345).
 */
export class ChatCompletionsStreamMapper {
  readonly #failure = new StreamFailureUsageTracker('openai');

  readonly #model: string;

  #messageId = '';

  #started = false;

  #textStarted = false;

  #textCompleted = false;

  #text = '';

  #refusal = '';

  #finishReason: FinishReason | null = null;

  #usage: Usage | null = null;

  #ended = false;

  readonly #toolCalls = new Map<number, { id: string; name: string; args: string }>();

  constructor(model: string) {
    this.#model = model;
  }

  /**
   * The events for one decoded chunk.
   *
   * @throws PrismError code `provider_response_error` for a refusal, once the
   *   chunk carrying a finish reason arrives (or the stream ends): earlier
   *   deltas are provisional, so a refusal is never completed as text.
   */
  map(payload: JsonObject): StreamEvent[] {
    this.#failure.record(payload);
    const events: StreamEvent[] = [];

    if (this.#ended) {
      return events;
    }

    if (!this.#started) {
      this.#started = true;
      this.#messageId = readString(payload.id, '');
      events.push(new StreamStartEvent(this.#model));
    }

    if (payload.error !== undefined && payload.error !== null) {
      const error = readObject(payload.error) ?? {};
      events.push(new ErrorEvent(
        readString(error.type, 'unknown_error'),
        readString(error.message, 'No error message provided'),
        undefined,
        undefined,
        false,
        this.failureUsage(),
      ));

      return events;
    }

    const usage = readObject(payload.usage);
    if (usage !== null) {
      this.#usage = chatUsage(usage);
    }

    const choice = readArray(payload.choices)[0];
    if (!isJsonObject(choice)) {
      return events;
    }

    const delta = readObject(choice.delta) ?? {};
    const rawFinish = choice.finish_reason;

    if (typeof delta.refusal === 'string') {
      this.#refusal += delta.refusal;
    }

    if (this.#refusal !== '' && rawFinish !== null && rawFinish !== undefined) {
      throw this.#refused();
    }

    if (readArray(delta.tool_calls).length > 0) {
      this.#accumulateToolCalls(delta);

      // A chunk carrying fragments is read for those alone, as the reference
      // does -- UNLESS it also finishes the turn. Some servers put the last
      // fragment and `finish_reason: "tool_calls"` in one chunk; returning
      // here would drop every call and end the stream as a plain Stop. The
      // reference has that defect; this port does not copy it.
      if (rawFinish === null || rawFinish === undefined) {
        return events;
      }
    }

    const finishReason = mapChatFinishReason(rawFinish);

    if (finishReason === FinishReason.ToolCalls) {
      this.#completeText(events);

      for (const call of this.#toolCalls.values()) {
        // Flushed once the arguments are whole, never as fragments.
        events.push(new ToolCallEvent(new ToolCall(call.id, call.name, call.args), this.#messageId));
      }

      this.#finishReason = FinishReason.ToolCalls;
      events.push(this.#end());

      return events;
    }

    const content = typeof delta.content === 'string' ? delta.content : '';

    if (content !== '') {
      if (!this.#textStarted) {
        this.#textStarted = true;
        events.push(new TextStartEvent(this.#messageId));
      }

      this.#text += content;
      events.push(new TextDeltaEvent(content, this.#messageId));
    }

    if (rawFinish !== null && rawFinish !== undefined) {
      this.#completeText(events);
      this.#finishReason = finishReason;
    }

    return events;
  }

  /**
   * The closing events once the transport is done: a refusal that never saw a
   * finish chunk is still refused, and otherwise the stream ends with the
   * finish reason it reported (Stop when none was).
   */
  finish(): StreamEvent[] {
    if (this.#ended) {
      return [];
    }

    if (this.#refusal !== '') {
      throw this.#refused();
    }

    return [this.#end()];
  }

  failureUsage(): StreamFailureUsage | null {
    return this.#failure.snapshot();
  }

  decodeFailure(): ErrorEvent {
    return new ErrorEvent('stream_decode_error', 'The stream contained invalid JSON.', undefined, undefined, false, this.failureUsage());
  }

  #refused(): PrismError {
    return PrismError.providerResponseError(`OpenAI refused the request: ${this.#refusal}`)
      .withStreamFailureUsage(this.failureUsage());
  }

  #completeText(events: StreamEvent[]): void {
    if (this.#textStarted && !this.#textCompleted && this.#text !== '') {
      this.#textCompleted = true;
      events.push(new TextCompleteEvent(this.#text, this.#messageId));
    }
  }

  #end(): StreamEndEvent {
    this.#ended = true;

    // Usage stays null when the provider reported none: a zeroed Usage would
    // claim the generation was free.
    return new StreamEndEvent(this.#finishReason ?? FinishReason.Stop, this.#usage);
  }

  /** The id and name arrive on the first fragment; a later one never blanks them. */
  #accumulateToolCalls(delta: JsonObject): void {
    readArray(delta.tool_calls).forEach((raw, position) => {
      if (!isJsonObject(raw)) {
        return;
      }

      const index = readNumber(raw.index, position);
      const fn = readObject(raw.function) ?? {};
      const existing = this.#toolCalls.get(index) ?? { id: '', name: '', args: '' };

      this.#toolCalls.set(index, {
        id: readString(raw.id, '') || existing.id,
        name: readString(fn.name, '') || existing.name,
        args: ToolCall.appendArgumentFragment(existing.args, fn.arguments),
      });
    });
  }
}

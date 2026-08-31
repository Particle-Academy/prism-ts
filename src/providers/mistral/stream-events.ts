import { isJsonObject, type JsonObject } from '../../json.js';
import { FinishReason } from '../../enums.js';
import { readArray, readNumber, readObject, readString } from '../../internal/filters.js';
import {
  StreamEndEvent,
  type StreamEvent,
  StreamStartEvent,
  TextCompleteEvent,
  TextDeltaEvent,
  TextStartEvent,
  ToolCallEvent,
} from '../../streaming/events.js';
import { ToolCall } from '../../value-objects/tool-call.js';
import { Usage } from '../../value-objects/usage.js';

/**
 * Mistral's chat-completions stream, which needs MEMORY.
 *
 * Every chunk is a `chat.completion.chunk` carrying a `delta` and nothing else
 * — no message id after the first chunk, no accumulated text, and tool-call
 * arguments arrive SPLIT ACROSS CHUNKS keyed only by an index. So a chunk
 * cannot be mapped in isolation, the way an OpenAI Responses event can.
 *
 * That puts this closer to the Anthropic mapper than to the OpenAI one, for a
 * different provider-side reason, and it carries the same consequence: one
 * instance per stream. A shared mapper would let two concurrent generations
 * read each other's accumulated text, which surfaces under load and looks like
 * the model hallucinating.
 */
export class MistralStreamMapper {
  #messageId = '';

  #model = '';

  #started = false;

  #textStarted = false;

  #text = '';

  #usage: Usage | null = null;

  /** Tool-call fragments being assembled, keyed by the index Mistral sends. */
  readonly #toolCalls = new Map<number, { id: string; name: string; args: string }>();

  /**
   * The events for one chunk — zero, one, or several.
   *
   * SEVERAL, unlike the other mappers' one-or-none, because a single Mistral
   * chunk can both start the stream and carry the first token, and the final
   * chunk can complete the text, flush a tool call and end the stream at once.
   * Returning only the first would drop the rest silently.
   */
  map(payload: JsonObject): StreamEvent[] {
    const events: StreamEvent[] = [];

    if (!this.#started) {
      this.#started = true;
      this.#messageId = readString(payload.id, '');
      this.#model = readString(payload.model, '');
      events.push(new StreamStartEvent(this.#model));
    }

    const usage = readObject(payload.usage);

    if (usage !== null) {
      // Usage arrives on the LAST chunk on Mistral, not alongside the deltas,
      // so it is stored rather than emitted and read again at stream end.
      this.#usage = new Usage(readNumber(usage.prompt_tokens, 0), readNumber(usage.completion_tokens, 0));
    }

    const choice = readArray(payload.choices)[0];

    if (!isJsonObject(choice)) {
      return events;
    }

    const delta = readObject(choice.delta) ?? {};
    const text = deltaText(delta);

    if (text !== '') {
      if (!this.#textStarted) {
        this.#textStarted = true;
        events.push(new TextStartEvent(this.#messageId));
      }

      this.#text += text;
      events.push(new TextDeltaEvent(text, this.#messageId));
    }

    this.#accumulateToolCalls(delta);

    const finishReason = readString(choice.finish_reason, '');

    if (finishReason !== '') {
      if (this.#textStarted) {
        events.push(new TextCompleteEvent(this.#text, this.#messageId));
      }

      for (const call of this.#toolCalls.values()) {
        // Flushed at the END, once the arguments are whole. Emitting a tool
        // call while its JSON is still arriving hands a consumer a fragment
        // that will not parse.
        events.push(new ToolCallEvent(new ToolCall(call.id, call.name, call.args === '' ? '{}' : call.args), this.#messageId));
      }

      // Usage stays NULL when Mistral reported none, rather than becoming a
      // zeroed Usage — zero tokens claims the generation was free. The event's
      // third parameter is the event's own id, not the message id; passing the
      // message id there compiles fine and quietly renames every end event.
      events.push(new StreamEndEvent(mapStreamFinishReason(finishReason), this.#usage));
    }

    return events;
  }

  /**
   * Tool-call fragments, merged by index.
   *
   * The id and name arrive on the FIRST fragment only and the arguments arrive
   * a few characters at a time, so each field is written only when the chunk
   * actually carries it — overwriting the name with an empty string on the
   * second fragment is how a tool call ends up nameless.
   */
  #accumulateToolCalls(delta: JsonObject): void {
    for (const raw of readArray(delta.tool_calls)) {
      if (!isJsonObject(raw)) {
        continue;
      }

      const index = readNumber(raw.index, 0);
      const fn = readObject(raw.function) ?? {};
      const existing = this.#toolCalls.get(index) ?? { id: '', name: '', args: '' };

      this.#toolCalls.set(index, {
        id: readString(raw.id, '') || existing.id,
        name: readString(fn.name, '') || existing.name,
        args: existing.args + readString(fn.arguments, ''),
      });
    }
  }
}

/**
 * A delta's text, from either shape.
 *
 * `content` is a string on ordinary models and an array of typed chunks on
 * reasoning ones. An array stringified is `[object Object]`, which reaches the
 * consumer as tokens the model never produced.
 */
function deltaText(delta: JsonObject): string {
  if (typeof delta.content === 'string') {
    return delta.content;
  }

  return readArray(delta.content)
    .filter(isJsonObject)
    .filter((chunk) => chunk.type === 'text')
    .map((chunk) => readString(chunk.text, ''))
    .join('');
}

function mapStreamFinishReason(reason: string): FinishReason {
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

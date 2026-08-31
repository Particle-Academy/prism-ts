import type { JsonObject } from '../../json.js';
import { isJsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import { FinishReason } from '../../enums.js';
import { readArray, readNullableNumber, readNumber, readObject, readString, whereNotNull } from '../../internal/filters.js';
import type { TextRequest } from '../../text/request.js';
import { ResponseBuilder } from '../../text/response-builder.js';
import type { TextResponse } from '../../text/response.js';
import { TextStep } from '../../text/step.js';
import { Meta } from '../../value-objects/meta.js';
import type { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';
import { ToolCall } from '../../value-objects/tool-call.js';
import { Usage } from '../../value-objects/usage.js';
import { mapFinishReason } from './maps/finish-reason-map.js';

export interface ParseTextResponseOptions {
  rateLimits?: readonly ProviderRateLimit[];
}

/**
 * Turn a raw Mistral chat-completions payload into a `TextResponse`.
 *
 * No HTTP happens here, so a stored payload replays through exactly the code
 * path a live call takes.
 *
 * @throws PrismError code `provider_response_error` when the payload is
 *   missing, empty, or carries a `message` under an error shape.
 * @throws PrismError code `max_tokens_exceeded` when generation was cut short.
 * @throws PrismError code `tool_loop_not_supported` when the response stopped
 *   on tool calls. Running tools is outside this port's slice, and returning a
 *   half-formed response would be worse than saying so.
 */
export function parseTextResponse(
  request: TextRequest,
  rawBody: unknown,
  options: ParseTextResponseOptions = {},
): TextResponse {
  const data = validateResponse(rawBody);
  const finishReason = mapFinishReason(data);

  if (finishReason === FinishReason.ToolCalls) {
    throw PrismError.toolLoopNotSupported();
  }

  if (finishReason === FinishReason.Length) {
    throw PrismError.maxTokensExceeded('length', 'chat.completion');
  }

  const builder = new ResponseBuilder();

  builder.addStep(buildStep(data, request, finishReason, options.rateLimits ?? []));

  return builder.toResponse();
}

export function validateResponse(rawBody: unknown): JsonObject {
  if (!isJsonObject(rawBody) || Object.keys(rawBody).length === 0) {
    throw PrismError.providerResponseError('Mistral returned an empty or non-object response body.');
  }

  // Mistral reports failures two ways: an `object: "error"` envelope, and a
  // bare `{ message, type }` on validation errors. Both are checked, because
  // only the first carries a recognisable marker and the second is what a
  // malformed request actually gets back.
  const error = readObject(rawBody.error);

  if (error !== null) {
    throw PrismError.providerResponseError(
      `Mistral error [${readString(error.type, 'unknown')}]: ${readString(error.message, 'unknown')}`,
    );
  }

  if (rawBody.object === 'error' || (typeof rawBody.message === 'string' && rawBody.choices === undefined)) {
    throw PrismError.providerResponseError(
      `Mistral error [${readString(rawBody.type, 'unknown')}]: ${readString(rawBody.message, 'unknown')}`,
    );
  }

  return rawBody;
}

/** The first choice, or an empty object. Mistral returns one unless `n` was set. */
export function firstChoiceMessage(data: JsonObject): JsonObject {
  const choice = readArray(data.choices)[0];

  return isJsonObject(choice) ? (readObject(choice.message) ?? {}) : {};
}

function buildStep(
  data: JsonObject,
  request: TextRequest,
  finishReason: FinishReason,
  rateLimits: readonly ProviderRateLimit[],
): TextStep {
  const message = firstChoiceMessage(data);
  const usage = readObject(data.usage) ?? {};

  return new TextStep({
    text: extractText(message),
    finishReason,
    toolCalls: mapToolCalls(message),
    usage: new Usage(
      readNumber(usage.prompt_tokens, 0),
      readNumber(usage.completion_tokens, 0),
      null,
      null,
      readNullableNumber(usage.reasoning_tokens),
    ),
    meta: new Meta(readString(data.id, ''), readString(data.model, ''), rateLimits, null),
    messages: request.messages(),
    systemPrompts: request.systemPrompts(),
    additionalContent: whereNotNull({ thinking: extractThinking(message) }),
    raw: data,
  });
}

/**
 * The reply text, from either shape Mistral uses.
 *
 * `content` is usually a string, but reasoning models return an ARRAY of typed
 * chunks — and taking the array's `toString()` yields `[object Object]`, which
 * looks like a model that answered nonsense rather than a parser that failed.
 */
export function extractText(message: JsonObject): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return readArray(message.content)
    .filter(isJsonObject)
    .filter((chunk) => chunk.type === 'text')
    .map((chunk) => readString(chunk.text, ''))
    .join('');
}

/** Reasoning chunks joined, or null when the model did not think. */
export function extractThinking(message: JsonObject): string | null {
  const parts = readArray(message.content)
    .filter(isJsonObject)
    .filter((chunk) => chunk.type === 'thinking')
    .flatMap((chunk) => readArray(chunk.thinking))
    .filter(isJsonObject)
    .map((part) => readString(part.text, ''))
    .filter((text) => text !== '');

  return parts.length > 0 ? parts.join('') : null;
}

function mapToolCalls(message: JsonObject): ToolCall[] {
  return readArray(message.tool_calls)
    .filter(isJsonObject)
    .map((call) => {
      const fn = readObject(call.function) ?? {};

      return new ToolCall(
        readString(call.id, ''),
        readString(fn.name, ''),
        // A JSON STRING on the wire, like OpenAI's chat completions and unlike
        // Anthropic's decoded object. Kept as the string; `parsedArguments()`
        // is the one place it is decoded.
        typeof fn.arguments === 'string' ? fn.arguments : isJsonObject(fn.arguments) ? fn.arguments : '{}',
        null,
      );
    });
}

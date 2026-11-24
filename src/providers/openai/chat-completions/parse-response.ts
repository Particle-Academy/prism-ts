import type { JsonObject } from '../../../json.js';
import { isJsonObject } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import { FinishReason } from '../../../enums.js';
import { readArray, readNumber, readObject, readString } from '../../../internal/filters.js';
import type { TextRequest } from '../../../text/request.js';
import { ResponseBuilder } from '../../../text/response-builder.js';
import type { TextResponse } from '../../../text/response.js';
import { TextStep } from '../../../text/step.js';
import { Meta } from '../../../value-objects/meta.js';
import type { ProviderRateLimit } from '../../../value-objects/provider-rate-limit.js';
import { ToolCall } from '../../../value-objects/tool-call.js';
import { Usage } from '../../../value-objects/usage.js';
import { mapChatFinishReason } from './maps.js';

export interface ParseChatResponseOptions {
  rateLimits?: readonly ProviderRateLimit[];
  /**
   * The structured path. The reference's chat structured handler reads any
   * finish reason, where its text handler refuses the ones it does not handle.
   */
  structured?: boolean;
}

/**
 * Turn a chat-completions payload into a `TextResponse`, as the reference's
 * `ChatCompletions\Text` and `ChatCompletions\Structured` handlers read it.
 *
 * @throws PrismError code `provider_response_error` for an empty payload, an
 *   `error` inside it, a model refusal, or (text only) a finish reason the
 *   reference does not handle.
 * @throws PrismError code `tool_loop_not_supported` when the reply finished on
 *   tool calls. This port runs no tool loop, so it refuses rather than run a
 *   tool or hand back a half-finished turn (G-339, G-345, G-352): the tool
 *   never runs and no second request is sent.
 */
export function parseChatTextResponse(
  request: TextRequest,
  rawBody: unknown,
  options: ParseChatResponseOptions = {},
): TextResponse {
  const data = validateChatResponse(rawBody);
  const message = firstChoiceMessage(data);

  const refusal = message.refusal;
  if (typeof refusal === 'string' && refusal !== '') {
    throw PrismError.providerResponseError(`OpenAI refused the request: ${refusal}`);
  }

  const finishReason = mapChatFinishReason(firstChoice(data).finish_reason);

  if (finishReason === FinishReason.ToolCalls) {
    throw PrismError.toolLoopNotSupported();
  }

  if (options.structured !== true && finishReason !== FinishReason.Stop && finishReason !== FinishReason.Length) {
    throw PrismError.providerResponseError('OpenAI: unhandled finish reason');
  }

  const builder = new ResponseBuilder();
  builder.addStep(new TextStep({
    text: typeof message.content === 'string' ? message.content : '',
    finishReason,
    toolCalls: mapToolCalls(message),
    usage: chatUsage(readObject(data.usage)),
    meta: new Meta(readString(data.id, ''), readString(data.model, ''), options.rateLimits ?? [], null),
    messages: request.messages(),
    systemPrompts: request.systemPrompts(),
    additionalContent: {},
    raw: data,
  }));

  return builder.toResponse();
}

/** The reference's `ValidatesResponse`: an empty payload or any `error` fails. */
export function validateChatResponse(rawBody: unknown): JsonObject {
  if (!isJsonObject(rawBody) || Object.keys(rawBody).length === 0) {
    throw PrismError.providerResponseError('OpenAI Error:  [unknown] unknown');
  }

  if (rawBody.error !== undefined && rawBody.error !== null && rawBody.error !== false && rawBody.error !== '') {
    const error = readObject(rawBody.error) ?? {};
    throw PrismError.providerResponseError(
      `OpenAI Error:  [${readString(error.type, 'unknown')}] ${readString(error.message, 'unknown')}`,
    );
  }

  return rawBody;
}

/**
 * Usage with cached prompt tokens taken OUT of the prompt count and reported
 * on their own, as the reference does; a cache count of zero is null.
 */
export function chatUsage(usage: JsonObject | null): Usage {
  const raw = usage ?? {};
  const cached = readNumber(readObject(raw.prompt_tokens_details)?.cached_tokens, 0);

  return new Usage(
    Math.max(0, readNumber(raw.prompt_tokens, 0) - cached),
    readNumber(raw.completion_tokens, 0),
    null,
    cached === 0 ? null : cached,
  );
}

function firstChoice(data: JsonObject): JsonObject {
  const choice = readArray(data.choices)[0];

  return isJsonObject(choice) ? choice : {};
}

function firstChoiceMessage(data: JsonObject): JsonObject {
  return readObject(firstChoice(data).message) ?? {};
}

/** Arguments are held as the provider sent them; `parsedArguments()` judges them (G-341). */
function mapToolCalls(message: JsonObject): ToolCall[] {
  return readArray(message.tool_calls)
    .filter(isJsonObject)
    .map((call) => {
      const fn = readObject(call.function) ?? {};

      return new ToolCall(readString(call.id, ''), readString(fn.name, ''), ToolCall.storableArguments(fn.arguments));
    });
}

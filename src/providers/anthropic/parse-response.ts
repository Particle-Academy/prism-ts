import type { JsonObject, JsonValue } from '../../json.js';
import { isJsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import { FinishReason } from '../../enums.js';
import {
  isTruthyByReferenceRules,
  readArray,
  readNullableNumber,
  readNumber,
  readObject,
  readString,
  whereNotNull,
} from '../../internal/filters.js';
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
 * Turn a raw Anthropic Messages payload into a `TextResponse`.
 *
 * No HTTP happens here, so a stored payload can be replayed through exactly the
 * code path a live call takes.
 *
 * @throws PrismError code `provider_response_error` when the payload is missing,
 *   empty, or carries an `error`.
 * @throws PrismError code `max_tokens_exceeded` when generation was cut short.
 * @throws PrismError code `tool_loop_not_supported` when the response stopped on
 *   tool use. Running tools is outside this port's slice, and returning a
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

  // A Length finish RETURNS the partial answer here, and does not throw.
  //
  // The reference's stance is per-PROVIDER rather than uniform, which is easy to
  // misread: Anthropic and Mistral return, OpenAI's Responses handler and its
  // structured handler throw, and Azure throws. This port previously threw for
  // all three providers, so it matched the reference on OpenAI and diverged on
  // the other two.
  //
  // Returning is the right behaviour to copy here. The model did write something
  // usable and you paid for the tokens, and running out of room is exactly when
  // the usage numbers matter most -- it is the expensive case and the unfinished
  // one at once, so throwing discards the reasoning-token count on the very call
  // where a caller most wants it.
  //
  // The cost is real and is the caller's to manage: code that ignores
  // finishReason will treat a truncated answer as a complete one. That is why
  // FinishReason.Length is on the response rather than implied.
  //
  // Found by prism-parity's anthropic-text-response suite (G-50). The existing
  // seventeen OpenAI rows never caught it because none of them sends a
  // max_tokens finish.

  const builder = new ResponseBuilder();

  builder.addStep(buildStep(data, request, finishReason, options.rateLimits ?? []));

  return builder.toResponse();
}

function validateResponse(rawBody: unknown): JsonObject {
  if (!isJsonObject(rawBody) || Object.keys(rawBody).length === 0) {
    throw PrismError.providerResponseError('Anthropic returned an empty or non-object response body.');
  }

  // Anthropic reports failures with `type: "error"` at the top level, and the
  // HTTP status is not always 4xx for them — so this is checked on the body
  // rather than left to the caller's status check.
  if (rawBody.type === 'error' || isTruthyByReferenceRules(rawBody.error)) {
    const error = readObject(rawBody.error) ?? {};

    throw PrismError.providerResponseError(
      `Anthropic error [${readString(error.type, 'unknown')}]: ${readString(error.message, 'unknown')}`,
    );
  }

  return rawBody;
}

function buildStep(
  data: JsonObject,
  request: TextRequest,
  finishReason: FinishReason,
  rateLimits: readonly ProviderRateLimit[],
): TextStep {
  const content = readArray(data.content);
  const usage = readObject(data.usage) ?? {};

  return new TextStep({
    text: outputText(content),
    finishReason,
    toolCalls: mapToolCalls(content),
    usage: new Usage(
      // Anthropic reports cache tokens SEPARATELY from input_tokens rather than
      // inside them, so unlike the OpenAI mapping nothing is subtracted here.
      // Subtracting would under-report the prompt.
      readNumber(usage.input_tokens, 0),
      readNumber(usage.output_tokens, 0),
      readNullableNumber(usage.cache_creation_input_tokens),
      readNullableNumber(usage.cache_read_input_tokens),
      // Reasoning tokens, and a BREAKDOWN of output_tokens rather than an
      // addition to them -- 1240 thinking inside 2820 output, not beside.
      // Reported by the Moic Suite team against the live API; every Anthropic
      // path in all three languages was leaving this null, so no cross-language
      // check could see it. They agreed on something wrong.
      readNullableNumber(readObject(usage.output_tokens_details)?.thinking_tokens),
    ),
    meta: new Meta(readString(data.id, ''), readString(data.model, ''), rateLimits, null),
    messages: request.messages(),
    systemPrompts: request.systemPrompts(),
    additionalContent: whereNotNull({
      thinking: thinkingText(content),
      stopSequence: typeof data.stop_sequence === 'string' ? data.stop_sequence : null,
    }),
    raw: data,
  });
}

/**
 * Every text block joined, not just the first.
 *
 * Anthropic splits a reply across several text blocks when thinking or tool use
 * interleaves with it, so taking `content[0]` returns a truncated answer that
 * looks complete.
 */
function outputText(content: readonly JsonValue[]): string {
  return content
    .filter(isJsonObject)
    .filter((block) => block.type === 'text')
    .map((block) => readString(block.text, ''))
    .join('');
}

function mapToolCalls(content: readonly JsonValue[]): ToolCall[] {
  return content
    .filter(isJsonObject)
    .filter((block) => block.type === 'tool_use')
    .map(
      (block) =>
        new ToolCall(
          readString(block.id, ''),
          readString(block.name, ''),
          // An object on the wire, unlike the Responses API's JSON string.
          isJsonObject(block.input) ? block.input : {},
          null,
        ),
    );
}

/** Extended-thinking blocks joined, or null when the model did not think. */
function thinkingText(content: readonly JsonValue[]): string | null {
  const parts = content
    .filter(isJsonObject)
    .filter((block) => block.type === 'thinking')
    .map((block) => readString(block.thinking, ''))
    .filter((text) => text !== '');

  return parts.length > 0 ? parts.join('') : null;
}

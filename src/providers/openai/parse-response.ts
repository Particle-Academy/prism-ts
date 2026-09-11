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
import { GeneratedImage } from '../../value-objects/generated-image.js';
import { Meta } from '../../value-objects/meta.js';
import type { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';
import { ToolCall } from '../../value-objects/tool-call.js';
import { Usage } from '../../value-objects/usage.js';
import { lastOutputItem, mapFinishReason } from './maps/finish-reason-map.js';

export interface ParseTextResponseOptions {
  rateLimits?: readonly ProviderRateLimit[];
}

/**
 * Turn a raw OpenAI Responses payload into a `TextResponse`.
 *
 * No HTTP happens here, so a stored payload can be replayed through exactly the
 * code path a live call takes.
 *
 * @throws PrismError code `provider_response_error` when the payload is missing,
 *   empty, or carries an `error`.
 * @throws PrismError code `max_tokens_exceeded` when generation was cut short.
 * @throws PrismError code `tool_loop_not_supported` when the response finished
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
    const last = lastOutputItem(data) ?? {};

    throw PrismError.maxTokensExceeded(readString(last.status, ''), readString(last.type, ''));
  }

  const builder = new ResponseBuilder();

  builder.addStep(buildStep(data, request, finishReason, options.rateLimits ?? []));

  return builder.toResponse();
}

function validateResponse(rawBody: unknown): JsonObject {
  if (!isJsonObject(rawBody) || Object.keys(rawBody).length === 0) {
    throw PrismError.providerResponseError('OpenAI returned an empty or non-object response body.');
  }

  if (isTruthyByReferenceRules(rawBody.error)) {
    const error = readObject(rawBody.error) ?? {};

    throw PrismError.providerResponseError(
      `OpenAI error [${readString(error.type, 'unknown')}]: ${readString(error.message, 'unknown')}`,
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
  const output = readArray(data.output);
  const usage = readObject(data.usage) ?? {};
  const inputTokenDetails = readObject(usage.input_tokens_details) ?? {};
  const outputTokenDetails = readObject(usage.output_tokens_details) ?? {};

  return new TextStep({
    text: outputText(data),
    finishReason,
    toolCalls: mapToolCalls(output),
    usage: new Usage(
      // Prompt tokens EXCLUDE the cached ones — they are reported separately so
      // a caller can see what the cache saved instead of paying for it twice.
      readNumber(usage.input_tokens, 0) - readNumber(inputTokenDetails.cached_tokens, 0),
      readNumber(usage.output_tokens, 0),
      null,
      readNullableNumber(inputTokenDetails.cached_tokens),
      readNullableNumber(outputTokenDetails.reasoning_tokens),
    ),
    meta: new Meta(
      readString(data.id, ''),
      readString(data.model, ''),
      rateLimits,
      typeof data.service_tier === 'string' ? data.service_tier : null,
    ),
    messages: request.messages(),
    systemPrompts: request.systemPrompts(),
    additionalContent: whereNotNull({
      searchQueries: webSearchValues(output, 'search', 'query'),
      openPageUrls: webSearchValues(output, 'open_page', 'url'),
      findInPagePatterns: webSearchValues(output, 'find_in_page', 'pattern'),
      reasoningSummaries: reasoningSummaries(output),
      generatedImages: generatedImages(output),
      imageGenerationCalls: imageGenerationCalls(output),
    }),
    raw: data,
  });
}

/** The reply text: the first content part of the last output item, or nothing. */
function outputText(data: JsonObject): string {
  const content = lastOutputItem(data)?.content;

  if (!Array.isArray(content)) {
    return '';
  }

  const first = content[0];

  return isJsonObject(first) ? readString(first.text, '') : '';
}

function mapToolCalls(output: readonly JsonValue[]): ToolCall[] {
  return output
    .filter(isJsonObject)
    .filter((item) => item.type === 'function_call')
    .map(
      (item) =>
        new ToolCall(
          readString(item.id, ''),
          readString(item.name, ''),
          typeof item.arguments === 'string' || isJsonObject(item.arguments) ? item.arguments : '',
          typeof item.call_id === 'string' ? item.call_id : null,
        ),
    );
}

/**
 * The distinct, non-empty values of one field across every web-search call of a
 * given action, or `null` when there were none — the not-null filter above then
 * drops the key rather than reporting an empty search.
 */
function webSearchValues(
  output: readonly JsonValue[],
  actionType: string,
  field: string,
): string[] | null {
  const values = output
    .filter(isJsonObject)
    .filter((item) => item.type === 'web_search_call')
    .map((item) => readObject(item.action) ?? {})
    .filter((action) => action.type === actionType)
    .map((action) => action[field])
    .filter((value): value is string => typeof value === 'string' && value !== '');

  const unique = [...new Set(values)];

  return unique.length > 0 ? unique : null;
}

/**
 * The images a HOSTED image tool generated, or null when there were none.
 *
 * Every other hosted tool here hands its output back through
 * `additionalContent`, and a turn that generated an image had nowhere to put
 * the bytes but `raw` — the untyped escape hatch, not a surface. So a caller
 * using `web_search` was served and a caller using `image_generation` was not.
 *
 * Built as the same `GeneratedImage` the images endpoint returns and then
 * SERIALISED, because `additionalContent` here is typed `JsonValue` and cannot
 * hold a class instance. The reference keeps the object; both ports emit its
 * serialised form, which is byte-identical once the step is serialised — so the
 * cross-language corpora agree and only the in-process ergonomics differ. That
 * difference is general to `additionalContent` in the ports rather than
 * anything about images, and is recorded as G-43 in the envelope's register.
 *
 * Constructed through the value object rather than assembling the literal by
 * hand, so the key names and the revised-prompt handling come from one place
 * and cannot drift from the images endpoint's shape.
 */
function generatedImages(output: readonly JsonValue[]): JsonObject[] | null {
  const images = output
    .filter(isJsonObject)
    .filter((item) => item.type === 'image_generation_call')
    .filter((item) => typeof item.result === 'string' && item.result !== '')
    .map((item) =>
      new GeneratedImage(
        null,
        readString(item.result, ''),
        typeof item.revised_prompt === 'string' ? item.revised_prompt : null,
      ).toObject(),
    );

  return images.length > 0 ? images : null;
}

/**
 * What the provider ACTUALLY drew, as opposed to what was asked for.
 *
 * Separate from the images because this is the part a caller reconciles against
 * its own request: a provider that silently served a different size or quality
 * is visible only here.
 */
function imageGenerationCalls(output: readonly JsonValue[]): JsonObject[] | null {
  const calls = output
    .filter(isJsonObject)
    .filter((item) => item.type === 'image_generation_call')
    .map((item) =>
      whereNotNull({
        id: typeof item.id === 'string' ? item.id : null,
        status: typeof item.status === 'string' ? item.status : null,
        revised_prompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : null,
        size: typeof item.size === 'string' ? item.size : null,
        quality: typeof item.quality === 'string' ? item.quality : null,
        background: typeof item.background === 'string' ? item.background : null,
        output_format: typeof item.output_format === 'string' ? item.output_format : null,
      }),
    );

  return calls.length > 0 ? calls : null;
}

/** Always present, even when empty — the reference does not drop this one. */
function reasoningSummaries(output: readonly JsonValue[]): string[] {
  return output
    .filter(isJsonObject)
    .filter((item) => item.type === 'reasoning')
    .flatMap((item) => readArray(item.summary))
    .filter(isJsonObject)
    .map((summary) => summary.text)
    .filter((text): text is string => typeof text === 'string' && text !== '');
}

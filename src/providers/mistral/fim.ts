import type { JsonObject, JsonValue } from '../../json.js';
import { FinishReason } from '../../enums.js';
import { readNumber, readObject, readString, whereNotNull } from '../../internal/filters.js';
import type { FimRequest } from '../../fim/request.js';
import { FimResponse } from '../../fim/response.js';
import { Meta } from '../../value-objects/meta.js';
import type { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';
import { Usage } from '../../value-objects/usage.js';
import { firstChoiceMessage, validateResponse } from './parse-response.js';

/**
 * Build the fill-in-the-middle request body.
 *
 * `model` and `prompt` are unconditional; everything else passes a NOT-NULL
 * filter so `withTemperature(0)` survives.
 *
 * `stop` collapses to null when EMPTY, matching the reference. An empty array
 * is truthy in JavaScript, so a direct port sends `"stop":[]` — which Mistral
 * accepts and which then reads, to anyone inspecting the request, as a caller
 * who asked for no stop sequences rather than one who never set any.
 */
export function buildFimBody(request: FimRequest): JsonObject {
  const stop = request.stop();

  return {
    model: request.model(),
    prompt: request.prompt(),
    ...whereNotNull({
      // The text AFTER the gap. Omitting it is legal and means "complete to the
      // end", which is a different request rather than a degraded one.
      suffix: request.suffix(),
      max_tokens: request.maxTokens(),
      temperature: request.temperature(),
      top_p: request.topP(),
      stop: stop.length > 0 ? [...stop] : null,
    } satisfies Record<string, JsonValue | null | undefined>),
  };
}

/**
 * Parse a FIM completion.
 *
 * The finish-reason mapping is DELIBERATELY NARROWER than the chat one, and
 * matches the reference: FIM answers only `stop` or `length`, so `tool_calls`
 * and `content_filter` are not special-cased. Anything unrecognised becomes
 * Unknown rather than Stop — a truncated completion reported as complete is how
 * an editor silently inserts half a function.
 *
 * Unlike `parseTextResponse`, a Length finish does NOT throw. Hitting the token
 * ceiling is an ordinary outcome for a completion: the caller wanted as much of
 * the gap as the budget bought, and the partial text is useful. `finishReason`
 * carries the fact.
 */
export function parseFimResponse(
  rawBody: unknown,
  request: FimRequest,
  rateLimits: readonly ProviderRateLimit[] = [],
): FimResponse {
  const data = validateResponse(rawBody);
  const message = firstChoiceMessage(data);
  const usage = readObject(data.usage) ?? {};

  return new FimResponse(
    readString(message.content, ''),
    mapFimFinishReason(data),
    new Usage(readNumber(usage.prompt_tokens, 0), readNumber(usage.completion_tokens, 0)),
    new Meta(readString(data.id, ''), readString(data.model, '') || request.model(), rateLimits, null),
    data,
  );
}

function mapFimFinishReason(data: JsonObject): FinishReason {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0];
  const reason =
    typeof first === 'object' && first !== null && !Array.isArray(first)
      ? readString((first as JsonObject).finish_reason, '')
      : '';

  switch (reason) {
    case 'stop':
      return FinishReason.Stop;
    case 'length':
    case 'model_length':
      return FinishReason.Length;
    default:
      return FinishReason.Unknown;
  }
}

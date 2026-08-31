import { isJsonObject, type JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { ModerationRequest } from '../../moderation/request.js';
import { ModerationResponse } from '../../moderation/response.js';
import { Meta } from '../../value-objects/meta.js';
import { ModerationResult } from '../../value-objects/moderation-result.js';

export function buildModerationBody(request: ModerationRequest): JsonObject {
  return { model: request.model(), input: [...request.inputs()] };
}

export function parseModerationResponse(rawBody: unknown, model: string): ModerationResponse {
  if (!isJsonObject(rawBody)) {
    // Refused rather than returning an empty response. An empty response has
    // `isFlagged() === false`, so a caller gating on it would let the content
    // through — a safety check that fails open on a malformed reply.
    throw PrismError.providerResponseError('OpenAI returned an empty or non-object moderation response.');
  }

  const results = Array.isArray(rawBody.results) ? rawBody.results : [];

  return new ModerationResponse({
    results: results.map((result) => ModerationResult.fromObject(result)),
    meta: new Meta(readString(rawBody.id), readString(rawBody.model) || model),
    raw: rawBody,
  });
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

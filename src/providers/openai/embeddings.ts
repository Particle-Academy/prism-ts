import { isJsonObject, type JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { EmbeddingsRequest } from '../../embeddings/request.js';
import { EmbeddingsResponse } from '../../embeddings/response.js';
import { Embedding } from '../../value-objects/embedding.js';
import { EmbeddingsUsage } from '../../value-objects/embeddings-usage.js';
import { Meta } from '../../value-objects/meta.js';
import { whereNotNull } from '../../internal/filters.js';

export function buildEmbeddingsBody(request: EmbeddingsRequest): JsonObject {
  return {
    model: request.model(),
    // Sent as a LIST even for one input, which is what the API accepts either
    // way — and keeping the shape constant means the response index maps to the
    // input index without a special case for the single-input call.
    input: [...request.inputs()],
    ...whereNotNull({
      dimensions: request.providerOptions('dimensions'),
      encoding_format: request.providerOptions('encoding_format'),
      user: request.providerOptions('user'),
    }),
  };
}

export function parseEmbeddingsResponse(rawBody: unknown): EmbeddingsResponse {
  if (!isJsonObject(rawBody)) {
    throw PrismError.providerResponseError('OpenAI returned an empty or non-object embeddings response.');
  }

  const data = Array.isArray(rawBody.data) ? rawBody.data : [];

  // ORDERED BY THE PROVIDER'S OWN INDEX, not by arrival. The API documents that
  // `data` may come back out of order, and an embeddings caller almost always
  // zips the result against the inputs it sent — so a silent reordering here
  // would attach every vector to the wrong text.
  const ordered = [...data]
    .filter(isJsonObject)
    .sort((a, b) => readNumber(a.index) - readNumber(b.index));

  return new EmbeddingsResponse({
    embeddings: ordered.map((item) => Embedding.fromArray(Array.isArray(item.embedding) ? item.embedding : [])),
    usage: new EmbeddingsUsage(readTokens(rawBody)),
    meta: new Meta(readString(rawBody.id), readString(rawBody.model)),
    raw: rawBody,
  });
}

/**
 * Null when the provider said nothing, rather than 0.
 *
 * A caller totalling spend across calls needs to tell "this cost nothing" from
 * "nobody told me what this cost"; folding them together makes the second
 * silently understate the first.
 */
function readTokens(body: JsonObject): number | null {
  const usage = isJsonObject(body.usage) ? body.usage : null;

  if (usage === null) {
    return null;
  }

  return typeof usage.total_tokens === 'number' ? usage.total_tokens : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

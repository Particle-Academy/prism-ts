import { isJsonObject, type JsonObject } from '../../json.js';
import type { EmbeddingsRequest } from '../../embeddings/request.js';
import { EmbeddingsResponse } from '../../embeddings/response.js';
import { readNullableNumber, readNumber, readObject, readString } from '../../internal/filters.js';
import { Embedding } from '../../value-objects/embedding.js';
import { EmbeddingsUsage } from '../../value-objects/embeddings-usage.js';
import { Meta } from '../../value-objects/meta.js';
import { validateResponse } from './parse-response.js';

/**
 * Mistral's embeddings body.
 *
 * Narrower than OpenAI's on purpose: Mistral takes `model` and `input` and
 * nothing else that the reference sends. `dimensions` and `encoding_format` are
 * OpenAI options and are not forwarded — sending an unknown key is rejected
 * outright by this endpoint rather than ignored.
 */
export function buildEmbeddingsBody(request: EmbeddingsRequest): JsonObject {
  return {
    model: request.model(),
    // A LIST even for one input, so a response index maps to an input index
    // without a special case for the single-input call.
    input: [...request.inputs()],
  };
}

export function parseEmbeddingsResponse(rawBody: unknown): EmbeddingsResponse {
  const data = validateResponse(rawBody);
  const items = Array.isArray(data.data) ? data.data : [];

  // ORDERED BY THE PROVIDER'S OWN INDEX, not by arrival, for the same reason
  // the OpenAI mapping does it: an embeddings caller zips the result against
  // the inputs it sent, so a silent reordering attaches every vector to the
  // wrong text.
  const ordered = [...items].filter(isJsonObject).sort((a, b) => readNumber(a.index, 0) - readNumber(b.index, 0));

  return new EmbeddingsResponse({
    embeddings: ordered.map((item) => Embedding.fromArray(Array.isArray(item.embedding) ? item.embedding : [])),
    // Mistral reports `total_tokens` only. Null rather than 0 when it says
    // nothing, because zero tokens claims the call was free.
    usage: new EmbeddingsUsage(readNullableNumber((readObject(data.usage) ?? {}).total_tokens)),
    meta: new Meta(readString(data.id, ''), readString(data.model, '')),
    raw: data,
  });
}

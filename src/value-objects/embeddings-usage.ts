import type { JsonObject } from '../json.js';

/**
 * What an embeddings call cost.
 *
 * Separate from `Usage` rather than reusing it: an embeddings response has no
 * completion tokens, and a shared type would report `completionTokens: 0` as
 * though none had been generated rather than because the concept does not
 * apply. Nullable for the same reason — a provider that reports nothing is
 * different from one that reports zero.
 */
export class EmbeddingsUsage {
  constructor(readonly tokens: number | null) {}

  toObject(): JsonObject {
    return { tokens: this.tokens };
  }
}

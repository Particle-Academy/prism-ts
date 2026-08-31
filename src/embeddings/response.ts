import type { JsonObject } from '../json.js';
import type { Embedding } from '../value-objects/embedding.js';
import type { EmbeddingsUsage } from '../value-objects/embeddings-usage.js';
import type { Meta } from '../value-objects/meta.js';

export interface EmbeddingsResponseOptions {
  embeddings: readonly Embedding[];
  usage: EmbeddingsUsage;
  meta: Meta;
  raw?: JsonObject | null;
}

export class EmbeddingsResponse {
  readonly embeddings: readonly Embedding[];

  readonly usage: EmbeddingsUsage;

  readonly meta: Meta;

  readonly raw: JsonObject | null;

  constructor(options: EmbeddingsResponseOptions) {
    this.embeddings = options.embeddings;
    this.usage = options.usage;
    this.meta = options.meta;
    this.raw = options.raw ?? null;
  }

  toObject(): JsonObject {
    return {
      embeddings: this.embeddings.map((embedding) => embedding.toObject()),
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
      raw: this.raw === null ? null : { ...this.raw },
    };
  }
}

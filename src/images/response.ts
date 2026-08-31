import type { JsonObject } from '../json.js';
import type { GeneratedImage } from '../value-objects/generated-image.js';
import type { Meta } from '../value-objects/meta.js';
import type { Usage } from '../value-objects/usage.js';

export interface ImagesResponseOptions {
  images: readonly GeneratedImage[];
  usage: Usage;
  meta: Meta;
  additionalContent?: Readonly<JsonObject>;
  raw?: JsonObject | null;
}

export class ImagesResponse {
  readonly images: readonly GeneratedImage[];

  readonly usage: Usage;

  readonly meta: Meta;

  readonly additionalContent: Readonly<JsonObject>;

  readonly raw: JsonObject | null;

  constructor(options: ImagesResponseOptions) {
    this.images = options.images;
    this.usage = options.usage;
    this.meta = options.meta;
    this.additionalContent = options.additionalContent ?? {};
    this.raw = options.raw ?? null;
  }

  /**
   * The first image, or null.
   *
   * Most callers ask for one image and want it without indexing. Nullable
   * rather than throwing: a provider that returned none has answered, and the
   * caller can see `raw` to find out why.
   */
  firstImage(): GeneratedImage | null {
    return this.images[0] ?? null;
  }

  toObject(): JsonObject {
    return {
      images: this.images.map((image) => image.toObject()),
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
      additional_content: { ...this.additionalContent },
      raw: this.raw === null ? null : { ...this.raw },
    };
  }
}

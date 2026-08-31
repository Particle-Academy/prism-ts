import type { Schema } from '../schema/index.js';
import type { StructuredMode } from '../enums.js';
import { TextRequest, type TextRequestOptions } from '../text/request.js';

export interface StructuredRequestOptions extends TextRequestOptions {
  schema: Schema;
  mode: StructuredMode;
}

/**
 * A text request that must come back shaped.
 *
 * EXTENDS `TextRequest` rather than restating it. The reference keeps two
 * separate request classes that carry the same twenty fields, which is a fair
 * choice in PHP where the duplication is visible and reviewed. Here it would be
 * a second copy nobody diffs: a field added to one and forgotten in the other
 * produces a request that builds fine and silently drops `topK` on structured
 * calls only. Everything a text request carries, a structured request carries
 * identically — by construction, not by agreement.
 *
 * What it adds is the pair that makes it structured: the SCHEMA the output must
 * satisfy, and the MODE describing how to ask the provider for it.
 */
export class StructuredRequest extends TextRequest {
  readonly #schema: Schema;

  readonly #mode: StructuredMode;

  constructor(options: StructuredRequestOptions) {
    super(options);

    this.#schema = options.schema;
    this.#mode = options.mode;
  }

  schema(): Schema {
    return this.#schema;
  }

  mode(): StructuredMode {
    return this.#mode;
  }
}

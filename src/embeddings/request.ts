import type { JsonObject, JsonValue } from '../json.js';

export interface EmbeddingsRequestOptions {
  model: string;
  providerKey: string;
  inputs: readonly string[];
  clientOptions?: Readonly<Record<string, unknown>>;
  providerOptions?: Readonly<JsonObject>;
}

export class EmbeddingsRequest {
  readonly #model: string;

  readonly #providerKey: string;

  readonly #inputs: readonly string[];

  readonly #clientOptions: Readonly<Record<string, unknown>>;

  #providerOptions: JsonObject;

  constructor(options: EmbeddingsRequestOptions) {
    this.#model = options.model;
    this.#providerKey = options.providerKey;
    this.#inputs = options.inputs;
    this.#clientOptions = options.clientOptions ?? {};
    this.#providerOptions = { ...(options.providerOptions ?? {}) };
  }

  model(): string {
    return this.#model;
  }

  providerKey(): string {
    return this.#providerKey;
  }

  /**
   * ALWAYS a list, even for one input.
   *
   * The reference accumulates every `fromInput` / `fromArray` / `fromFile` call
   * into one list, so a single input is a list of one rather than a special
   * case. Modelling it as `string | string[]` would push that branch into every
   * provider.
   */
  inputs(): readonly string[] {
    return this.#inputs;
  }

  clientOptions(): Readonly<Record<string, unknown>> {
    return this.#clientOptions;
  }

  providerOptions(): JsonObject;
  providerOptions(path: string): JsonValue | undefined;
  providerOptions(path?: string): JsonObject | JsonValue | undefined {
    return path === undefined ? this.#providerOptions : this.#providerOptions[path];
  }
}

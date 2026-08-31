import type { JsonObject, JsonValue } from '../json.js';

export interface ImagesRequestOptions {
  model: string;
  providerKey: string;
  prompt: string;
  clientOptions?: Readonly<Record<string, unknown>>;
  providerOptions?: Readonly<JsonObject>;
}

export class ImagesRequest {
  readonly #model: string;

  readonly #providerKey: string;

  readonly #prompt: string;

  readonly #clientOptions: Readonly<Record<string, unknown>>;

  readonly #providerOptions: JsonObject;

  constructor(options: ImagesRequestOptions) {
    this.#model = options.model;
    this.#providerKey = options.providerKey;
    this.#prompt = options.prompt;
    this.#clientOptions = options.clientOptions ?? {};
    this.#providerOptions = { ...(options.providerOptions ?? {}) };
  }

  model(): string {
    return this.#model;
  }

  providerKey(): string {
    return this.#providerKey;
  }

  prompt(): string {
    return this.#prompt;
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

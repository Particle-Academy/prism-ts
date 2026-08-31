import type { JsonObject, JsonValue } from '../json.js';

export interface ModerationRequestOptions {
  model: string;
  providerKey: string;
  inputs: readonly string[];
  clientOptions?: Readonly<Record<string, unknown>>;
  providerOptions?: Readonly<JsonObject>;
}

export class ModerationRequest {
  readonly #model: string;

  readonly #providerKey: string;

  readonly #inputs: readonly string[];

  readonly #clientOptions: Readonly<Record<string, unknown>>;

  readonly #providerOptions: JsonObject;

  constructor(options: ModerationRequestOptions) {
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

  /** Always a list, so a result index maps to an input index. */
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

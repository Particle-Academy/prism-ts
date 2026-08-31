import type { JsonObject, JsonValue } from '../json.js';

export interface FimRequestOptions {
  model: string;
  providerKey: string;
  prompt: string;
  suffix?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  stop?: readonly string[];
  clientOptions?: Readonly<Record<string, unknown>>;
  providerOptions?: Readonly<JsonObject>;
}

/**
 * A fill-in-the-middle request: a prefix, an optional suffix, and a gap.
 *
 * No messages and no tools, unlike every other generation request. FIM is a
 * COMPLETION, not a conversation — the model is given code either side of a
 * hole and writes what goes in it, which is why an editor is the natural caller
 * and a chat transcript is not.
 */
export class FimRequest {
  readonly #model: string;

  readonly #providerKey: string;

  readonly #prompt: string;

  readonly #suffix: string | null;

  readonly #maxTokens: number | null;

  readonly #temperature: number | null;

  readonly #topP: number | null;

  readonly #stop: readonly string[];

  readonly #clientOptions: Readonly<Record<string, unknown>>;

  readonly #providerOptions: JsonObject;

  constructor(options: FimRequestOptions) {
    this.#model = options.model;
    this.#providerKey = options.providerKey;
    this.#prompt = options.prompt;
    this.#suffix = options.suffix ?? null;
    this.#maxTokens = options.maxTokens ?? null;
    this.#temperature = options.temperature ?? null;
    this.#topP = options.topP ?? null;
    this.#stop = options.stop ?? [];
    this.#clientOptions = options.clientOptions ?? {};
    this.#providerOptions = { ...(options.providerOptions ?? {}) };
  }

  model(): string {
    return this.#model;
  }

  providerKey(): string {
    return this.#providerKey;
  }

  /** The text BEFORE the gap. */
  prompt(): string {
    return this.#prompt;
  }

  /** The text AFTER the gap, or null when the model should complete to the end. */
  suffix(): string | null {
    return this.#suffix;
  }

  maxTokens(): number | null {
    return this.#maxTokens;
  }

  temperature(): number | null {
    return this.#temperature;
  }

  topP(): number | null {
    return this.#topP;
  }

  stop(): readonly string[] {
    return this.#stop;
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

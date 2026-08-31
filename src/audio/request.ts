import type { JsonObject, JsonValue } from '../json.js';
import type { Audio } from '../value-objects/media/audio.js';

interface BaseOptions {
  model: string;
  providerKey: string;
  clientOptions?: Readonly<Record<string, unknown>>;
  providerOptions?: Readonly<JsonObject>;
}

abstract class AudioRequestBase {
  readonly #model: string;

  readonly #providerKey: string;

  readonly #clientOptions: Readonly<Record<string, unknown>>;

  readonly #providerOptions: JsonObject;

  constructor(options: BaseOptions) {
    this.#model = options.model;
    this.#providerKey = options.providerKey;
    this.#clientOptions = options.clientOptions ?? {};
    this.#providerOptions = { ...(options.providerOptions ?? {}) };
  }

  model(): string {
    return this.#model;
  }

  providerKey(): string {
    return this.#providerKey;
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

export interface TextToSpeechRequestOptions extends BaseOptions {
  input: string;
  voice: string | null;
}

export class TextToSpeechRequest extends AudioRequestBase {
  readonly #input: string;

  readonly #voice: string | null;

  constructor(options: TextToSpeechRequestOptions) {
    super(options);
    this.#input = options.input;
    this.#voice = options.voice;
  }

  input(): string {
    return this.#input;
  }

  voice(): string | null {
    return this.#voice;
  }
}

export interface SpeechToTextRequestOptions extends BaseOptions {
  input: Audio;
}

export class SpeechToTextRequest extends AudioRequestBase {
  readonly #input: Audio;

  constructor(options: SpeechToTextRequestOptions) {
    super(options);
    this.#input = options.input;
  }

  input(): Audio {
    return this.#input;
  }
}

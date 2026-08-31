import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import { FimRequest } from './request.js';
import type { FimResponse } from './response.js';

/**
 * The builder for fill-in-the-middle.
 *
 * Deliberately NOT a subclass of the text builder, for the same reason
 * `embeddings` is not: a FIM request has no messages, no tools and no step
 * budget, and inheriting those would advertise controls that do nothing. What
 * it does have that no other builder does is a SUFFIX.
 */
export class FimPendingRequest {
  #provider: Provider | null = null;

  #providerKey = '';

  #model = '';

  #prompt = '';

  #suffix: string | null = null;

  #maxTokens: number | null = null;

  #temperature: number | null = null;

  #topP: number | null = null;

  #stop: readonly string[] = [];

  #providerOptions: JsonObject = {};

  #clientOptions: Record<string, unknown> = {};

  using(provider: string, model = '', providerConfig: Record<string, unknown> = {}): this {
    this.#providerKey = provider;
    this.#model = model;
    this.#provider = resolveProvider(provider, providerConfig);

    return this;
  }

  /** The text BEFORE the gap. REPLACES; a FIM call has one prompt. */
  withPrompt(prompt: string): this {
    this.#prompt = prompt;

    return this;
  }

  /** The text AFTER the gap. Omit it and the model completes to the end. */
  withSuffix(suffix: string | null): this {
    this.#suffix = suffix;

    return this;
  }

  withMaxTokens(maxTokens: number): this {
    this.#maxTokens = maxTokens;

    return this;
  }

  withTemperature(temperature: number): this {
    this.#temperature = temperature;

    return this;
  }

  withTopP(topP: number): this {
    this.#topP = topP;

    return this;
  }

  /** A single stop string or several. A string is wrapped, matching the reference. */
  withStop(stop: string | readonly string[]): this {
    this.#stop = typeof stop === 'string' ? [stop] : [...stop];

    return this;
  }

  withProviderOptions(options: Readonly<JsonObject> = {}): this {
    this.#providerOptions = { ...options };

    return this;
  }

  withClientOptions(options: Record<string, unknown>): this {
    this.#clientOptions = { ...options };

    return this;
  }

  provider(): Provider {
    if (this.#provider === null) {
      throw PrismError.unsupportedProviderAction(
        'Sending a request',
        'a pending request with no provider — call using() first',
      );
    }

    return this.#provider;
  }

  async asText(): Promise<FimResponse> {
    return this.provider().fim(this.toRequest());
  }

  toRequest(): FimRequest {
    return new FimRequest({
      model: this.#model,
      providerKey: this.#providerKey,
      prompt: this.#prompt,
      suffix: this.#suffix,
      maxTokens: this.#maxTokens,
      temperature: this.#temperature,
      topP: this.#topP,
      stop: this.#stop,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }
}

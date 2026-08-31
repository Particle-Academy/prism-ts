import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import { ImagesRequest } from './request.js';
import type { ImagesResponse } from './response.js';

/**
 * The fluent builder for image generation.
 *
 * Like the embeddings builder and unlike the structured one, it does not extend
 * the text builder: an image request has no messages, no tools and no step
 * budget, and inheriting those would advertise controls that do nothing.
 */
export class ImagesPendingRequest {
  #provider: Provider | null = null;

  #providerKey = '';

  #model = '';

  #prompt: string | null = null;

  #providerOptions: JsonObject = {};

  #clientOptions: Record<string, unknown> = {};

  using(provider: string, model = '', providerConfig: Record<string, unknown> = {}): this {
    this.#providerKey = provider;
    this.#model = model;
    this.#provider = resolveProvider(provider, providerConfig);

    return this;
  }

  /** REPLACES. An image request has one prompt, not a conversation. */
  withPrompt(prompt: string): this {
    this.#prompt = prompt;

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

  /**
   * @throws PrismError code `no_image_prompt` when none was set.
   *
   * Absence, not emptiness: `withPrompt('')` is refused by the provider with
   * its own message, which is more useful than one invented here. What this
   * catches is the caller who forgot the line entirely.
   */
  toRequest(): ImagesRequest {
    if (this.#prompt === null) {
      throw PrismError.noImagePrompt();
    }

    return new ImagesRequest({
      model: this.#model,
      providerKey: this.#providerKey,
      prompt: this.#prompt,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }

  async generate(): Promise<ImagesResponse> {
    return this.provider().images(this.toRequest());
  }
}

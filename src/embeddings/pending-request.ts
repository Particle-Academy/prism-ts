import { readFileSync } from 'node:fs';
import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import { EmbeddingsRequest } from './request.js';
import type { EmbeddingsResponse } from './response.js';

/**
 * The fluent builder for embeddings.
 *
 * NOT a subclass of the text builder, unlike the structured one. An embeddings
 * request has no system prompt, no tools, no temperature and no step budget —
 * inheriting twenty methods that all throw or silently do nothing would be a
 * larger lie than the small duplication of the four that apply.
 */
export class EmbeddingsPendingRequest {
  #provider: Provider | null = null;

  #providerKey = '';

  #model = '';

  #inputs: string[] = [];

  #providerOptions: JsonObject = {};

  #clientOptions: Record<string, unknown> = {};

  using(provider: string, model = '', providerConfig: Record<string, unknown> = {}): this {
    this.#providerKey = provider;
    this.#model = model;
    this.#provider = resolveProvider(provider, providerConfig);

    return this;
  }

  /** APPENDS, so several calls embed several inputs in one request. */
  fromInput(input: string): this {
    this.#inputs.push(input);

    return this;
  }

  fromArray(inputs: readonly string[]): this {
    this.#inputs.push(...inputs);

    return this;
  }

  /**
   * The file's contents as one input.
   *
   * Read eagerly rather than at send time: a caller that mistypes a path should
   * find out on the line that names it, not inside a provider call that has
   * already been billed for the inputs that came before it.
   */
  fromFile(path: string): this {
    try {
      this.#inputs.push(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw PrismError.unreadableInputFile(path, cause);
    }

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
   * @throws PrismError code `no_embedding_input` when nothing was given. An
   *   embeddings call with no input is billable, returns an empty list, and
   *   reads to the caller as a provider that answered nothing.
   */
  toRequest(): EmbeddingsRequest {
    if (this.#inputs.length === 0) {
      throw PrismError.noEmbeddingInput();
    }

    return new EmbeddingsRequest({
      model: this.#model,
      providerKey: this.#providerKey,
      inputs: [...this.#inputs],
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }

  async asEmbeddings(): Promise<EmbeddingsResponse> {
    return this.provider().embeddings(this.toRequest());
  }
}

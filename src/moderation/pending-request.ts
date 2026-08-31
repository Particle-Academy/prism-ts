import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import { ModerationRequest } from './request.js';
import type { ModerationResponse } from './response.js';

export class ModerationPendingRequest {
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

  /** APPENDS, so several calls moderate several inputs in one request. */
  withInput(...inputs: readonly string[]): this {
    this.#inputs.push(...inputs);

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
   * @throws PrismError code `no_moderation_input` when nothing was given.
   *
   * Refused rather than sent, and this one matters more than the others: an
   * empty moderation call returns no results, `isFlagged()` is then false, and
   * a caller gating on it lets everything through. A safety check that fails
   * open because it was called wrong is the worst shape in the package.
   */
  toRequest(): ModerationRequest {
    if (this.#inputs.length === 0) {
      throw PrismError.noModerationInput();
    }

    return new ModerationRequest({
      model: this.#model,
      providerKey: this.#providerKey,
      inputs: [...this.#inputs],
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }

  async asModeration(): Promise<ModerationResponse> {
    return this.provider().moderation(this.toRequest());
  }
}

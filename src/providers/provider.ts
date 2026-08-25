import { PrismError } from '../errors.js';
import type { TextRequest } from '../text/request.js';
import type { TextResponse } from '../text/response.js';

/**
 * The provider contract.
 *
 * Every capability has a default that THROWS with a stable code, so a provider
 * implements only what it actually supports and asking for anything else fails
 * the same way everywhere instead of returning a plausible-looking empty result.
 *
 * Only `text` is part of this port's slice. The remaining capabilities keep
 * their place in the contract but take `unknown` requests, because their request
 * and response types are not ported.
 */
export abstract class Provider {
  /** The name that appears in `unsupported_provider_action` failures. */
  abstract readonly providerName: string;

  text(_request: TextRequest): Promise<TextResponse> {
    throw PrismError.unsupportedProviderAction('text', this.providerName);
  }

  stream(_request: TextRequest): never {
    throw PrismError.unsupportedProviderAction('stream', this.providerName);
  }

  structured(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('structured', this.providerName);
  }

  embeddings(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('embeddings', this.providerName);
  }

  images(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('images', this.providerName);
  }

  moderation(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('moderation', this.providerName);
  }

  textToSpeech(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('textToSpeech', this.providerName);
  }

  speechToText(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('speechToText', this.providerName);
  }

  fim(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('fim', this.providerName);
  }

  batch(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('batch', this.providerName);
  }

  uploadFile(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('uploadFile', this.providerName);
  }
}

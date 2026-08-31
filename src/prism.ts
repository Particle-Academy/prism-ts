import { TextPendingRequest } from './text/pending-request.js';
import { EmbeddingsPendingRequest } from './embeddings/pending-request.js';
import { StructuredPendingRequest } from './structured/pending-request.js';

/**
 * The entry point.
 *
 * ```ts
 * const response = await Prism.text()
 *   .using('openai', 'gpt-4o')
 *   .withPrompt('Who are you?')
 *   .asText();
 * ```
 *
 * The static and instance forms are the same call; the instance form exists so
 * the shape matches the reference's facade.
 */
export class Prism {
  text(): TextPendingRequest {
    return new TextPendingRequest();
  }

  structured(): StructuredPendingRequest {
    return new StructuredPendingRequest();
  }

  static text(): TextPendingRequest {
    return new Prism().text();
  }

  static structured(): StructuredPendingRequest {
    return new Prism().structured();
  }

  embeddings(): EmbeddingsPendingRequest {
    return new EmbeddingsPendingRequest();
  }

  static embeddings(): EmbeddingsPendingRequest {
    return new Prism().embeddings();
  }
}

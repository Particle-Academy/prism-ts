import { TextPendingRequest } from './text/pending-request.js';
import { EmbeddingsPendingRequest } from './embeddings/pending-request.js';
import { AudioPendingRequest } from './audio/pending-request.js';
import { FilesPendingRequest } from './files/pending-request.js';
import { ImagesPendingRequest } from './images/pending-request.js';
import { ModerationPendingRequest } from './moderation/pending-request.js';
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

  images(): ImagesPendingRequest {
    return new ImagesPendingRequest();
  }

  static images(): ImagesPendingRequest {
    return new Prism().images();
  }

  moderation(): ModerationPendingRequest {
    return new ModerationPendingRequest();
  }

  static moderation(): ModerationPendingRequest {
    return new Prism().moderation();
  }

  audio(): AudioPendingRequest {
    return new AudioPendingRequest();
  }

  static audio(): AudioPendingRequest {
    return new Prism().audio();
  }

  files(): FilesPendingRequest {
    return new FilesPendingRequest();
  }

  static files(): FilesPendingRequest {
    return new Prism().files();
  }
}

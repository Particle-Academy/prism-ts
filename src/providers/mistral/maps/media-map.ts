import type { JsonObject } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import { whereNotNull } from '../../../internal/filters.js';
import type { Document } from '../../../value-objects/media/document.js';
import type { Image } from '../../../value-objects/media/image.js';
import { dataUri } from '../../support/media.js';

/**
 * Mistral's image part.
 *
 * `image_url` is an OBJECT wrapping a url string, and the url is either a real
 * one or a `data:` uri carrying the bytes — the chat-completions shape, which
 * is neither of the two the other providers here use. OpenAI's Responses API
 * spells the same thing `input_image` with a bare `image_url` string, and
 * Anthropic spells it a `source` block.
 */
export function mapImage(image: Image): JsonObject {
  if (!image.isUrl() && !image.hasBase64()) {
    throw PrismError.unsupportedMedia('Mistral', 'image', 'a url, or bytes it can send as base64');
  }

  return {
    type: 'image_url',
    image_url: { url: image.isUrl() ? image.url : dataUri(image, 'Mistral', 'image') },
  };
}

/**
 * Mistral's document part.
 *
 * A URL AND NOTHING ELSE. Mistral fetches the document itself, so unlike every
 * other media part in this package there is no base64 fallback — a document
 * read from disk cannot be sent to Mistral at all, and saying so here is the
 * difference between a clear failure and a 422 naming a field the caller never
 * set.
 */
export function mapDocument(document: Document): JsonObject {
  if (!document.isUrl()) {
    throw PrismError.unsupportedMedia('Mistral', 'document', 'a url only — it fetches the document itself');
  }

  return whereNotNull({
    type: 'document_url',
    document_url: document.url,
    document_name: document.documentTitle(),
  });
}

import type { JsonObject } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import type { Document } from '../../../value-objects/media/document.js';
import type { Image } from '../../../value-objects/media/image.js';
import { dataUri } from '../../support/media.js';

/**
 * The Responses API's image part.
 *
 * `image_url` here is a BARE STRING, where Mistral's chat-completions shape
 * wraps the same value in an object. A file id goes in its own field rather
 * than through the url, because a `data:` uri and a provider-side file are two
 * different things to OpenAI even though both end up as `input_image`.
 */
export function mapImage(image: Image): JsonObject {
  if (image.isFileId()) {
    return { type: 'input_image', file_id: image.fileId() };
  }

  if (image.isUrl()) {
    return { type: 'input_image', image_url: image.url };
  }

  if (!image.hasBase64()) {
    throw PrismError.unsupportedMedia('OpenAI', 'image', 'a file id, a url, or bytes it can send as base64');
  }

  return { type: 'input_image', image_url: dataUri(image, 'OpenAI', 'image') };
}

/**
 * The Responses API's document part.
 *
 * Three shapes for one concept, and the inline one needs a FILENAME: OpenAI
 * reads the extension off it to decide how to parse the bytes, so a document
 * with no title is sent as `document` rather than omitting the field, matching
 * the reference. The other two shapes carry the name in the url or the file.
 *
 * Chunks are rejected. They are text with no container, and only Anthropic has
 * somewhere to put them.
 */
export function mapDocument(document: Document): JsonObject {
  if (document.isFileId()) {
    return { type: 'input_file', file_id: document.fileId() };
  }

  if (document.isUrl()) {
    return { type: 'input_file', file_url: document.url };
  }

  if (document.isChunks()) {
    throw PrismError.unsupportedMedia('OpenAI', 'document', 'a file id, a url, or bytes — not pre-split chunks');
  }

  if (!document.hasBase64()) {
    throw PrismError.unsupportedMedia('OpenAI', 'document', 'a file id, a url, or bytes it can send as base64');
  }

  return {
    type: 'input_file',
    filename: document.documentTitle() ?? 'document',
    file_data: dataUri(document, 'OpenAI', 'document'),
  };
}

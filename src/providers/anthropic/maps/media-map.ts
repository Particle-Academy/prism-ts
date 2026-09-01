import type { JsonObject } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import { whereNotNull } from '../../../internal/filters.js';
import type { Document } from '../../../value-objects/media/document.js';
import type { Image } from '../../../value-objects/media/image.js';

/**
 * Anthropic's image block.
 *
 * The payload never appears at the top level: it goes in a `source` object
 * whose OWN `type` says which of the three forms it is. So an image block
 * carries two `type` keys at two depths meaning different things — the outer
 * one is the block kind, the inner one is where the bytes came from.
 */
export function mapImage(image: Image): JsonObject {
  return { type: 'image', source: imageSource(image) };
}

function imageSource(image: Image): JsonObject {
  if (image.isFileId()) {
    return { type: 'file', file_id: image.fileId() };
  }

  if (image.isUrl()) {
    return { type: 'url', url: image.url };
  }

  const base64 = image.base64();
  const mimeType = image.mimeType();

  if (base64 === null || mimeType === null) {
    throw PrismError.unsupportedMedia(
      'Anthropic',
      'image',
      'a file id, a url, or bytes with a known mime type',
    );
  }

  return { type: 'base64', media_type: mimeType, data: base64 };
}

/**
 * Anthropic's document block.
 *
 * The only provider here that takes a document five ways, and the only one that
 * takes CHUNKS at all — pre-split text as a `content` source, each chunk its own
 * text block.
 *
 * Text documents go as `text`, not base64: Anthropic reads a `text/*` source
 * directly and base64-wrapping it would make the model's citations point into an
 * encoded blob.
 */
export function mapDocument(document: Document): JsonObject {
  return whereNotNull({
    type: 'document',
    title: document.documentTitle(),
    source: documentSource(document),
  });
}

function documentSource(document: Document): JsonObject {
  if (document.isFileId()) {
    return { type: 'file', file_id: document.fileId() };
  }

  if (document.isUrl()) {
    return { type: 'url', url: document.url };
  }

  const chunks = document.chunks();

  if (chunks !== null) {
    return {
      type: 'content',
      content: chunks.map((chunk) => ({ type: 'text', text: chunk })),
    };
  }

  const mimeType = document.mimeType();
  const rawContent = document.rawContent();

  if (mimeType !== null && mimeType.startsWith('text/')) {
    if (rawContent === null) {
      throw PrismError.unsupportedMedia('Anthropic', 'text document', 'bytes it can decode');
    }

    // `fatal: true`. The default decoder replaces every invalid byte with
    // U+FFFD, so a document declared `text/plain` that is not actually UTF-8
    // would reach the model as text peppered with replacement characters — and
    // Anthropic cites into that content, so the citation would point at
    // corruption. `prism-py` raised on the same input; both now refuse it by
    // name, which is the answer the two ports have to share.
    let decoded: string;

    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawContent);
    } catch (cause) {
      throw PrismError.unsupportedMedia(
        'Anthropic',
        'text document',
        `valid UTF-8, or a mime type that is not text/* — ${String(cause)}`,
      );
    }

    return { type: 'text', media_type: mimeType, data: decoded };
  }

  const base64 = document.base64();

  if (base64 === null || mimeType === null) {
    throw PrismError.unsupportedMedia(
      'Anthropic',
      'document',
      'a file id, a url, chunks, or bytes with a known mime type',
    );
  }

  return { type: 'base64', media_type: mimeType, data: base64 };
}

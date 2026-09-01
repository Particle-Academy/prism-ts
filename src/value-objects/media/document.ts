import type { JsonObject } from '../../json.js';
import { Media } from './media.js';

/**
 * A document — a PDF, a text file, or text supplied directly as chunks.
 *
 * Two things a plain `Media` does not have, both because every provider that
 * accepts a document asks for them:
 *
 *  - a TITLE, sent as `document_name` by Mistral, `filename` by OpenAI and
 *    `title` by Anthropic;
 *  - CHUNKS, pre-split text sent as a `content` source. Anthropic is the only
 *    provider here that takes them.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE REFERENCE. The reference threads the title
 * through every factory as the SECOND positional argument — `Document::fromUrl(
 * $url, $title)` — where the same position on the `Media` base means the mime
 * type. So `Document::fromUrl($url, 'application/pdf')` silently sets the title
 * to "application/pdf" and leaves the mime type unset. Inheriting that here
 * would be inheriting a trap the type system cannot see, since both are
 * `string`. The factories keep their base meaning and the title is set by
 * {@link titled}, which cannot be confused with anything.
 */
export class Document extends Media {
  readonly kind = 'document' as const;

  #documentTitle: string | null = null;

  #chunks: readonly string[] | null = null;

  /**
   * A document supplied as pre-split text.
   *
   * Carries no bytes and no mime type — the chunks ARE the document. Only
   * Anthropic accepts this form; the other two mappers reject it by name rather
   * than sending an empty payload.
   */
  static fromChunks(chunks: readonly string[], title: string | null = null): Document {
    const document = new Document();
    document.#chunks = [...chunks];

    return title === null ? document : document.titled(title);
  }

  /** Text as a document, rather than as part of the prompt. */
  static fromText(text: string, title: string | null = null): Document {
    const document = Document.fromRawContent(new TextEncoder().encode(text), 'text/plain');

    return title === null ? document : document.titled(title);
  }

  static fromObject(object: JsonObject): Document {
    const document = Document.restoreInto(new Document(...Document.constructorArgs(object)), object);

    if (typeof object.document_title === 'string') {
      document.titled(object.document_title);
    }

    if (Array.isArray(object.chunks)) {
      document.#chunks = object.chunks.filter((chunk): chunk is string => typeof chunk === 'string');
    }

    return document;
  }

  /** Name this document for the provider. Returns itself, so it chains onto a factory. */
  titled(title: string): this {
    this.#documentTitle = title;

    return this;
  }

  documentTitle(): string | null {
    return this.#documentTitle;
  }

  chunks(): readonly string[] | null {
    return this.#chunks;
  }

  isChunks(): boolean {
    return this.#chunks !== null;
  }

  override toObject(): JsonObject {
    return {
      ...super.toObject(),
      document_title: this.#documentTitle,
      chunks: this.#chunks === null ? null : [...this.#chunks],
    };
  }
}

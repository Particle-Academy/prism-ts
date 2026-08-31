import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';

/**
 * A binary payload, however it was given to us.
 *
 * One type behind five ways of naming the same bytes — a url, a base64 string,
 * a local file, raw content, or a provider-side file id. Subclasses add nothing
 * but a name; `Image` and `Audio` differ in what a provider does with them, not
 * in what they are.
 *
 * The alternative was three standalone classes each restating url / base64 /
 * mimeType, which is how a package ends up with three subtly different answers
 * to "is this a file". `GeneratedImage` was the first of those and is now
 * `Image`'s sibling under this base.
 *
 * TWO DELIBERATE DIVERGENCES FROM THE REFERENCE, both recorded in the port gaps
 * register:
 *
 *  - `fromStoragePath` is absent. It resolves through Laravel's filesystem, and
 *    there is no equivalent here to resolve through.
 *  - A url is NEVER fetched implicitly. The reference reads url content on
 *    demand inside `rawContent()`, so touching a property performs an outbound
 *    request; here `fetch()` is explicit and separate. A value object that
 *    reaches the network when you read it turns a stored locator into a request
 *    at replay time, which is the exact hazard prism-harness documents about
 *    replaying threads.
 */
export abstract class Media {
  #base64: string | null;

  #mimeType: string | null;

  #rawContent: Uint8Array | null = null;

  #localPath: string | null = null;

  #fileId: string | null = null;

  #filename: string | null = null;

  constructor(
    readonly url: string | null = null,
    base64: string | null = null,
    mimeType: string | null = null,
  ) {
    this.#base64 = base64;
    this.#mimeType = mimeType;
  }

  static fromFileId<T extends Media>(this: new () => T, fileId: string): T {
    const media = new this();
    media.setFileId(fileId);

    return media;
  }

  static fromUrl<T extends Media>(this: new (url?: string | null) => T, url: string, mimeType: string | null = null): T {
    const media = new this(url);

    if (mimeType !== null) {
      media.setMimeType(mimeType);
    }

    return media;
  }

  static fromBase64<T extends Media>(
    this: new (url?: string | null, base64?: string | null, mimeType?: string | null) => T,
    base64: string,
    mimeType: string | null = null,
  ): T {
    return new this(null, base64, mimeType);
  }

  static fromRawContent<T extends Media>(this: new () => T, content: Uint8Array, mimeType: string | null = null): T {
    const media = new this();
    media.setRawContent(content, mimeType);

    return media;
  }

  /**
   * Read a file from disk.
   *
   * Refuses an EMPTY file, matching the reference. A zero-byte upload is almost
   * always a mistake upstream, and a provider's error for it is far less useful
   * than one naming the path.
   */
  static fromLocalPath<T extends Media>(this: new () => T, path: string, mimeType: string | null = null): T {
    let content: Uint8Array;

    try {
      // Same reason as base64 decoding: a plain Uint8Array, not a Buffer.
      content = Uint8Array.from(readFileSync(path));
    } catch (cause) {
      throw PrismError.unreadableMediaFile(path, cause);
    }

    if (content.byteLength === 0) {
      throw PrismError.unreadableMediaFile(path, new Error('the file is empty'));
    }

    const media = new this();
    media.setRawContent(content, mimeType ?? guessMimeType(path));
    media.setLocalPath(path);

    return media;
  }

  /** Alias, matching the reference's spelling. */
  static fromPath<T extends Media>(this: new () => T, path: string): T {
    return (this as unknown as typeof Media).fromLocalPath.call(this, path) as T;
  }

  /** Name this payload for a provider that wants a filename. */
  as(name: string): this {
    this.#filename = name;

    return this;
  }

  filename(): string | null {
    return this.#filename;
  }

  fileId(): string | null {
    return this.#fileId;
  }

  localPath(): string | null {
    return this.#localPath;
  }

  isFileId(): boolean {
    return this.#fileId !== null;
  }

  isFile(): boolean {
    return this.#localPath !== null;
  }

  isUrl(): boolean {
    return this.url !== null;
  }

  hasBase64(): boolean {
    return this.#base64 !== null || this.#rawContent !== null;
  }

  hasMimeType(): boolean {
    return this.#mimeType !== null;
  }

  hasRawContent(): boolean {
    return this.#rawContent !== null;
  }

  mimeType(): string | null {
    return this.#mimeType;
  }

  rawContent(): Uint8Array | null {
    if (this.#rawContent !== null) {
      return this.#rawContent;
    }

    if (this.#base64 !== null) {
      // Copied into a plain Uint8Array rather than handed out as a Buffer.
      // Buffer is a Uint8Array subclass, so returning one satisfies the type
      // while leaking a Node-specific value that serialises differently — it
      // JSON-encodes as `{type:'Buffer',data:[…]}`, which is not what a caller
      // reading a `Uint8Array` expects to persist.
      return Uint8Array.from(Buffer.from(this.#base64, 'base64'));
    }

    // A url is NOT fetched here. See the class docblock.
    return null;
  }

  /**
   * The payload as base64, or null when only a url or file id is known.
   *
   * Computed once and kept, because encoding a large file on every access is a
   * cost a caller cannot see.
   */
  base64(): string | null {
    if (this.#base64 !== null) {
      return this.#base64;
    }

    if (this.#rawContent === null) {
      return null;
    }

    this.#base64 = Buffer.from(this.#rawContent).toString('base64');

    return this.#base64;
  }

  /**
   * Fetch a url's bytes into this payload. EXPLICIT, never automatic.
   *
   * Separate from `rawContent()` so that reading a property never performs an
   * outbound request — a stored locator becoming a request the moment something
   * replays it is the hazard, not the fetch itself.
   */
  async fetch(): Promise<this> {
    if (this.url === null) {
      throw PrismError.unfetchableMedia('this payload has no url');
    }

    const response = await globalThis.fetch(this.url);

    if (!response.ok) {
      throw PrismError.unfetchableMedia(`${this.url} responded ${response.status}`);
    }

    this.setRawContent(
      new Uint8Array(await response.arrayBuffer()),
      this.#mimeType ?? response.headers.get('content-type'),
    );

    return this;
  }

  toObject(): JsonObject {
    return {
      url: this.url,
      base64: this.#base64,
      mime_type: this.#mimeType,
      file_id: this.#fileId,
      filename: this.#filename,
    };
  }

  protected setRawContent(content: Uint8Array, mimeType: string | null): void {
    this.#rawContent = content;

    if (mimeType !== null) {
      this.#mimeType = mimeType;
    }
  }

  protected setMimeType(mimeType: string): void {
    this.#mimeType = mimeType;
  }

  protected setLocalPath(path: string): void {
    this.#localPath = path;
  }

  protected setFileId(fileId: string): void {
    this.#fileId = fileId;
  }
}

/**
 * Mime type from the file extension.
 *
 * The reference sniffs the CONTENT with finfo. Node has no equivalent without a
 * dependency, and this package takes none — so the extension is the guess, and
 * an unknown one returns null rather than a plausible default. `application/
 * octet-stream` would be accepted by a provider and then rejected as the wrong
 * kind of file, which is a worse failure than being asked for the type.
 */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
};

export function guessMimeType(path: string): string | null {
  return MIME_TYPES[extname(path).toLowerCase()] ?? null;
}

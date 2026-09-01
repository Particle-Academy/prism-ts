import { PrismError } from '../../errors.js';
import type { Media } from '../../value-objects/media/media.js';

/**
 * A payload as a `data:` uri.
 *
 * Shared by the two providers that inline bytes into a url string rather than
 * into a field of their own. `provider` and `part` are only carried so a
 * failure here names the same provider the caller's mapper would have.
 *
 * The mime type is REQUIRED and never defaulted: a `data:;base64,` uri is
 * accepted by both providers and then fails as the wrong kind of file, which is
 * a worse failure than being told the type is missing. `guessMimeType` reads
 * the extension, so a payload built from raw content is the case that arrives
 * here without one.
 */
export function dataUri(media: Media, provider: string, part: string): string {
  const base64 = media.base64();

  if (base64 === null) {
    throw PrismError.unsupportedMedia(provider, part, 'a url, or bytes to encode');
  }

  const mimeType = media.mimeType();

  if (mimeType === null) {
    throw PrismError.unsupportedMedia(
      provider,
      part,
      'bytes with a known mime type — pass one to the factory when it cannot be read from a file extension',
    );
  }

  return `data:${mimeType};base64,${base64}`;
}

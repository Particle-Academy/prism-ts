import type { JsonObject } from '../json.js';
import { Audio } from './media/audio.js';

/**
 * Speech a provider generated.
 *
 * Extends `Audio`, so it answers the same questions every other payload does —
 * `base64()`, `rawContent()`, `mimeType()`. It exists as its own type only
 * because the reference has one, and because `type` (the provider's own format
 * name, e.g. `mp3`) is not the same thing as a mime type and should not be
 * quietly stored as one.
 */
export class GeneratedAudio extends Audio {
  constructor(
    base64: string | null = null,
    /** The provider's format name — `mp3`, `wav`, `opus`. Not a mime type. */
    readonly type: string | null = null,
    mimeType: string | null = null,
  ) {
    super(null, base64, mimeType);
  }

  override toObject(): JsonObject {
    return { ...super.toObject(), type: this.type };
  }
}

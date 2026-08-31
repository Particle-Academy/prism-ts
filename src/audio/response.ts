import type { JsonObject } from '../json.js';
import type { GeneratedAudio } from '../value-objects/generated-audio.js';
import type { Usage } from '../value-objects/usage.js';

/** What `asAudio()` returns: speech, and whatever else the provider said. */
export class AudioResponse {
  constructor(
    readonly audio: GeneratedAudio,
    readonly additionalContent: Readonly<JsonObject> = {},
  ) {}

  toObject(): JsonObject {
    return { audio: this.audio.toObject(), additional_content: { ...this.additionalContent } };
  }
}

/**
 * What `asText()` returns: a transcript.
 *
 * `usage` is NULLABLE because transcription is billed by audio duration on most
 * providers and they report no tokens at all. Zero would claim it was free.
 */
export class AudioTextResponse {
  constructor(
    readonly text: string,
    readonly usage: Usage | null = null,
    readonly additionalContent: Readonly<JsonObject> = {},
  ) {}

  toObject(): JsonObject {
    return {
      text: this.text,
      usage: this.usage === null ? null : this.usage.toObject(),
      additional_content: { ...this.additionalContent },
    };
  }
}

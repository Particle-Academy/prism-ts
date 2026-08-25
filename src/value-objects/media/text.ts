import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';

/**
 * A plain-text part of a user message.
 *
 * The only media part this port carries. Images, documents, audio and video are
 * out of scope, so a media part that is not text cannot be rebuilt and
 * `fromObject` says so rather than guessing.
 */
export class Text {
  constructor(readonly text: string) {}

  toObject(): JsonObject {
    return { text: this.text };
  }

  static fromObject(object: JsonObject): Text {
    if (typeof object.text !== 'string') {
      throw PrismError.unknownMessageType(
        `media part ${JSON.stringify(object)} (this port only carries text parts)`,
      );
    }

    return new Text(object.text);
  }
}

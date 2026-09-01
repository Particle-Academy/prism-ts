import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import { Audio } from './audio.js';
import { Document } from './document.js';
import { Image } from './image.js';
import type { Media } from './media.js';
import { Text } from './text.js';
import { Video } from './video.js';

/**
 * One part of a user turn: text, or a payload.
 *
 * `Media` rather than the four subclasses by name, so a payload type added
 * later is a part without this union having to be edited to allow it.
 */
export type MessagePart = Text | Media;

/**
 * Rebuild a part from its serialized form.
 *
 * NO `kind` MEANS TEXT. That is the specified form rather than a tolerated one:
 * a text part serializes as `{ text }` in this port, in `prism-py` and in the
 * PHP reference alike, pinned by the conformance corpus — see {@link Text}. So
 * every user message any consumer has already stored reads back unchanged, and
 * a discriminator is only ever needed to tell the payload kinds apart from each
 * other, which is the one thing their keys cannot do (an image, an audio file
 * and a video serialize identically).
 *
 * @throws PrismError code `unknown_message_type`
 */
export function partFromObject(object: JsonObject): MessagePart {
  switch (object.kind) {
    case 'text':
      return Text.fromObject(object);
    case 'image':
      return Image.fromObject(object);
    case 'document':
      return Document.fromObject(object);
    case 'audio':
      return Audio.fromObject(object);
    case 'video':
      return Video.fromObject(object);
    case undefined:
      if (typeof object.text === 'string') {
        return Text.fromObject(object);
      }

      throw PrismError.unknownMessageType(`media part ${JSON.stringify(object)} (no \`kind\`, and no text to fall back to)`);
    default:
      throw PrismError.unknownMessageType(`media part of kind ${JSON.stringify(object.kind)}`);
  }
}

import type { JsonObject } from '../../json.js';
import { isJsonObject } from '../../json.js';
import { Audio } from '../media/audio.js';
import { Document } from '../media/document.js';
import { Image } from '../media/image.js';
import { Media } from '../media/media.js';
import type { MessagePart } from '../media/part.js';
import { partFromObject } from '../media/part.js';
import { Text } from '../media/text.js';
import { Video } from '../media/video.js';

export class UserMessage {
  readonly type = 'user' as const;

  readonly content: string;

  /**
   * Every part of this turn, with the turn's own `content` appended as a text
   * part at the END — the reference does the same, and `text()` depends on it.
   */
  readonly additionalContent: readonly MessagePart[];

  /**
   * Attributes that are SPREAD at item level when the message is mapped, so
   * they land as siblings of `role` and `content` rather than nested under a
   * key of their own.
   */
  readonly additionalAttributes: Readonly<JsonObject>;

  constructor(
    content: string,
    additionalContent: readonly MessagePart[] = [],
    additionalAttributes: Readonly<JsonObject> = {},
  ) {
    this.content = content;
    this.additionalContent = [...additionalContent, new Text(content)];
    this.additionalAttributes = { ...additionalAttributes };
  }

  /**
   * The TEXT parts, concatenated.
   *
   * Filtered, not mapped over everything: once a turn can carry an image, a
   * blind `.map(part => part.text)` would read `undefined` off it and put the
   * string "undefined" in front of the model.
   */
  text(): string {
    return this.additionalContent
      .filter((part): part is Text => part instanceof Text)
      .map((part) => part.text)
      .join('');
  }

  images(): Image[] {
    return this.additionalContent.filter((part): part is Image => part instanceof Image);
  }

  documents(): Document[] {
    return this.additionalContent.filter((part): part is Document => part instanceof Document);
  }

  audios(): Audio[] {
    return this.additionalContent.filter((part): part is Audio => part instanceof Audio);
  }

  videos(): Video[] {
    return this.additionalContent.filter((part): part is Video => part instanceof Video);
  }

  /**
   * Every NON-TEXT part.
   *
   * Images and documents included. The reference's equivalent tests for
   * `Audio || Video || Media` and the first two are redundant — both extend
   * `Media` — so what it returns is every media part, and this returns the
   * same. Worth saying out loud, because the name reads narrower than it is.
   */
  media(): Media[] {
    return this.additionalContent.filter((part): part is Media => part instanceof Media);
  }

  toObject(): JsonObject {
    return {
      type: 'user',
      content: this.content,
      additional_content: this.additionalContent.map((part) => part.toObject()),
      additional_attributes: { ...this.additionalAttributes },
    };
  }

  static fromObject(object: JsonObject): UserMessage {
    const content = typeof object.content === 'string' ? object.content : '';

    const parts = (Array.isArray(object.additional_content) ? object.additional_content : [])
      .filter(isJsonObject)
      .map(partFromObject);

    // The constructor re-appends `Text(content)`, so the trailing part the
    // serialized form carries has to come back off or every round trip would
    // duplicate the turn's own text. Only a trailing TEXT part that actually
    // MATCHES the content is dropped; anything else is a caller-supplied part
    // and stays.
    const last = parts.at(-1);
    const supplied = last instanceof Text && last.text === content ? parts.slice(0, -1) : parts;

    return new UserMessage(
      content,
      supplied,
      isJsonObject(object.additional_attributes) ? object.additional_attributes : {},
    );
  }
}

import type { JsonObject } from '../../json.js';
import { isJsonObject } from '../../json.js';
import { Text } from '../media/text.js';

export class UserMessage {
  readonly type = 'user' as const;

  readonly content: string;

  /**
   * Every part of this turn, with the turn's own `content` appended as a text
   * part at the END — the reference does the same, and `text()` depends on it.
   */
  readonly additionalContent: readonly Text[];

  /**
   * Attributes that are SPREAD at item level when the message is mapped, so
   * they land as siblings of `role` and `content` rather than nested under a
   * key of their own.
   */
  readonly additionalAttributes: Readonly<JsonObject>;

  constructor(
    content: string,
    additionalContent: readonly Text[] = [],
    additionalAttributes: Readonly<JsonObject> = {},
  ) {
    this.content = content;
    this.additionalContent = [...additionalContent, new Text(content)];
    this.additionalAttributes = { ...additionalAttributes };
  }

  text(): string {
    return this.additionalContent.map((part) => part.text).join('');
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
      .map((part) => Text.fromObject(part));

    // The constructor re-appends `Text(content)`, so the trailing part the
    // serialized form carries has to come back off or every round trip would
    // duplicate the turn's own text. Only a trailing part that actually MATCHES
    // the content is dropped; anything else is a caller-supplied part and stays.
    const last = parts.at(-1);
    const supplied = last !== undefined && last.text === content ? parts.slice(0, -1) : parts;

    return new UserMessage(
      content,
      supplied,
      isJsonObject(object.additional_attributes) ? object.additional_attributes : {},
    );
  }
}

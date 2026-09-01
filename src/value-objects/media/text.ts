import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';

/**
 * A plain-text part of a user message.
 *
 * SERIALIZES AS `{ text }` AND NOTHING ELSE — no `kind` discriminator, unlike
 * every other part. That asymmetry is deliberate and load-bearing: the
 * conformance corpus pins this exact form (`rtp-0001`, and every row of
 * `openai-text-response`), and the PHP reference emits it too, so a text part
 * is one of the few places all three implementations are byte-identical.
 * Adding a key for symmetry would take both ports out of parity with the
 * reference on the only part type the reference can currently produce, and
 * would make every message a consumer has already stored unreadable.
 *
 * A part carrying no `kind` therefore MEANS text, which is what
 * {@link partFromObject} relies on.
 */
export class Text {
  readonly kind = 'text' as const;

  constructor(readonly text: string) {}

  toObject(): JsonObject {
    return { text: this.text };
  }

  static fromObject(object: JsonObject): Text {
    if (typeof object.text !== 'string') {
      throw PrismError.unknownMessageType(`media part ${JSON.stringify(object)} (a text part needs a string \`text\`)`);
    }

    return new Text(object.text);
  }
}

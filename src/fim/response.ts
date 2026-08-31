import type { JsonObject } from '../json.js';
import type { FinishReason } from '../enums.js';
import type { Meta } from '../value-objects/meta.js';
import type { Usage } from '../value-objects/usage.js';

/**
 * What the model wrote into the gap.
 *
 * Flat, with no `steps` and no `messages`, unlike `TextResponse`. A FIM call is
 * one round trip that cannot call a tool, so there is nothing to accumulate and
 * modelling it with a step list would advertise a loop that does not exist.
 */
export class FimResponse {
  constructor(
    readonly text: string,
    readonly finishReason: FinishReason,
    readonly usage: Usage,
    readonly meta: Meta,
    readonly raw: JsonObject | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      text: this.text,
      finish_reason: this.finishReason,
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
    };
  }
}

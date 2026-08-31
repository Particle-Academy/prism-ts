import type { JsonObject } from '../json.js';
import type { Meta } from '../value-objects/meta.js';
import type { ModerationResult } from '../value-objects/moderation-result.js';

export interface ModerationResponseOptions {
  results: readonly ModerationResult[];
  meta: Meta;
  raw?: JsonObject | null;
}

export class ModerationResponse {
  readonly results: readonly ModerationResult[];

  readonly meta: Meta;

  readonly raw: JsonObject | null;

  constructor(options: ModerationResponseOptions) {
    this.results = options.results;
    this.meta = options.meta;
    this.raw = options.raw ?? null;
  }

  /**
   * Whether ANY input was flagged.
   *
   * The question almost every caller actually asks, and the one most likely to
   * be got wrong by hand: a caller checking `results[0]` alone passes a batch
   * whose second input was the problem.
   */
  isFlagged(): boolean {
    return this.results.some((result) => result.flagged);
  }

  firstFlagged(): ModerationResult | null {
    return this.results.find((result) => result.flagged) ?? null;
  }

  flagged(): readonly ModerationResult[] {
    return this.results.filter((result) => result.flagged);
  }

  toObject(): JsonObject {
    return {
      results: this.results.map((result) => result.toObject()),
      meta: this.meta.toObject(),
      raw: this.raw === null ? null : { ...this.raw },
    };
  }
}

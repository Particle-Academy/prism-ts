import type { JsonObject } from '../json.js';
import type { FinishReason } from '../enums.js';
import type { Meta } from '../value-objects/meta.js';
import type { Usage } from '../value-objects/usage.js';
import type { TextStep } from '../text/step.js';

export interface StructuredResponseOptions {
  steps: readonly TextStep[];
  text: string;
  structured: JsonObject | null;
  finishReason: FinishReason;
  usage: Usage;
  meta: Meta;
  additionalContent?: Readonly<JsonObject>;
  raw?: JsonObject | null;
}

/**
 * The answer, and the answer parsed.
 *
 * `text` and `structured` are BOTH kept, and the pairing is the point: `text`
 * is what the model actually said, `structured` is what could be made of it.
 *
 * `structured` IS NULLABLE, AND NULL IS NOT AN ERROR. A model asked for JSON can
 * return prose — a refusal, an apology, a fenced block with commentary around it
 * — and the reference reports that by leaving `structured` null while `text`
 * still carries what came back. Collapsing the two, or throwing on unparseable
 * output, would take away the one artifact that explains WHY it did not parse.
 *
 * So a caller checks `structured` before using it, and reads `text` when it is
 * null. The type says so; `JsonObject | null` cannot be indexed without the
 * check.
 */
export class StructuredResponse {
  readonly steps: readonly TextStep[];

  readonly text: string;

  readonly structured: JsonObject | null;

  readonly finishReason: FinishReason;

  readonly usage: Usage;

  readonly meta: Meta;

  readonly additionalContent: Readonly<JsonObject>;

  readonly raw: JsonObject | null;

  constructor(options: StructuredResponseOptions) {
    this.steps = options.steps;
    this.text = options.text;
    this.structured = options.structured;
    this.finishReason = options.finishReason;
    this.usage = options.usage;
    this.meta = options.meta;
    this.additionalContent = options.additionalContent ?? {};
    this.raw = options.raw ?? null;
  }

  toObject(): JsonObject {
    return {
      steps: this.steps.map((step) => step.toObject()),
      text: this.text,
      structured: this.structured === null ? null : { ...this.structured },
      finish_reason: this.finishReason,
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
      additional_content: { ...this.additionalContent },
      raw: this.raw === null ? null : { ...this.raw },
    };
  }
}

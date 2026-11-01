import type { JsonObject } from '../json.js';
import { TextStep } from '../text/step.js';
import type { TextStepOptions } from '../text/step.js';

export interface StructuredStepOptions extends TextStepOptions {
  structured?: Readonly<JsonObject>;
}

/** One structured round trip, including its completed conversation. */
export class StructuredStep extends TextStep {
  readonly structured: Readonly<JsonObject>;

  constructor(options: StructuredStepOptions) {
    super(options);
    this.structured = options.structured ?? {};
  }

  override toObject(): JsonObject {
    return {
      text: this.text,
      finish_reason: this.finishReason,
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
      messages: this.messages.map((message) => message.toObject()),
      system_prompts: this.systemPrompts.map((prompt) => prompt.toObject()),
      additional_content: { ...this.additionalContent },
      structured: { ...this.structured },
      tool_calls: this.toolCalls.map((call) => call.toObject()),
      tool_results: this.toolResults.map((result) => result.toObject()),
      provider_tool_calls: this.providerToolCalls.map((call) => ({ ...call })),
      raw: this.raw === null ? null : { ...this.raw },
    };
  }
}

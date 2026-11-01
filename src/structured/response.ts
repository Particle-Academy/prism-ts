import type { JsonObject } from '../json.js';
import type { FinishReason } from '../enums.js';
import type { Meta } from '../value-objects/meta.js';
import type { Usage } from '../value-objects/usage.js';
import type { TextStep } from '../text/step.js';
import type { ToolCall } from '../value-objects/tool-call.js';
import type { ToolResult } from '../value-objects/tool-result.js';
import { StructuredStep } from './step.js';

export interface StructuredResponseOptions {
  steps: readonly TextStep[];
  text: string;
  structured: JsonObject | null;
  finishReason: FinishReason;
  usage: Usage;
  meta: Meta;
  additionalContent?: Readonly<JsonObject>;
  raw?: JsonObject | null;
  toolCalls?: readonly ToolCall[];
  providerToolCalls?: readonly JsonObject[];
  toolResults?: readonly ToolResult[];
}

/**
 * The parsed result and its native conversation state.
 *
 * OpenAI and Mistral retain JSON in text. Anthropic's native output-format
 * mode exposes the parsed result with empty text; its original JSON remains in
 * the assistant message and raw response. Check the nullable structured value
 * before reading fields from it.
 */
export class StructuredResponse {
  readonly steps: readonly StructuredStep[];

  readonly text: string;

  readonly structured: JsonObject | null;

  readonly finishReason: FinishReason;

  readonly usage: Usage;

  readonly meta: Meta;

  readonly additionalContent: Readonly<JsonObject>;

  readonly raw: JsonObject | null;

  readonly toolCalls: readonly ToolCall[];

  readonly providerToolCalls: readonly JsonObject[];

  readonly toolResults: readonly ToolResult[];

  constructor(options: StructuredResponseOptions) {
    this.steps = options.steps.map((step) => step instanceof StructuredStep ? step : new StructuredStep(step));
    this.text = options.text;
    this.structured = options.structured;
    this.finishReason = options.finishReason;
    this.usage = options.usage;
    this.meta = options.meta;
    this.additionalContent = options.additionalContent ?? {};
    this.raw = options.raw ?? null;
    this.toolCalls = options.toolCalls ?? [];
    this.providerToolCalls = options.providerToolCalls ?? [];
    this.toolResults = options.toolResults ?? [];
  }

  toObject(): JsonObject {
    return {
      steps: this.steps.map((step) => step.toObject()),
      text: this.text,
      structured: this.structured === null ? null : { ...this.structured },
      finish_reason: this.finishReason,
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
      tool_calls: this.toolCalls.map((call) => call.toObject()),
      provider_tool_calls: this.providerToolCalls.map((call) => ({ ...call })),
      tool_results: this.toolResults.map((result) => result.toObject()),
      additional_content: { ...this.additionalContent },
      raw: this.raw === null ? null : { ...this.raw },
    };
  }
}

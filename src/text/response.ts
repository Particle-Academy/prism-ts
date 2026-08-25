import type { JsonObject } from '../json.js';
import type { FinishReason } from '../enums.js';
import type { Message } from '../value-objects/messages/index.js';
import type { Meta } from '../value-objects/meta.js';
import type { ToolCall } from '../value-objects/tool-call.js';
import type { ToolResult } from '../value-objects/tool-result.js';
import type { Usage } from '../value-objects/usage.js';
import type { TextStep } from './step.js';

export interface TextResponseOptions {
  steps: readonly TextStep[];
  text: string;
  finishReason: FinishReason;
  toolCalls?: readonly ToolCall[];
  toolResults?: readonly ToolResult[];
  usage: Usage;
  meta: Meta;
  messages: readonly Message[];
  additionalContent?: Readonly<JsonObject>;
  raw?: JsonObject | null;
}

export class TextResponse {
  readonly steps: readonly TextStep[];

  readonly text: string;

  readonly finishReason: FinishReason;

  readonly toolCalls: readonly ToolCall[];

  readonly toolResults: readonly ToolResult[];

  readonly usage: Usage;

  readonly meta: Meta;

  /** The conversation as it now stands: the input messages plus the reply. */
  readonly messages: readonly Message[];

  readonly additionalContent: Readonly<JsonObject>;

  readonly raw: JsonObject | null;

  constructor(options: TextResponseOptions) {
    this.steps = options.steps;
    this.text = options.text;
    this.finishReason = options.finishReason;
    this.toolCalls = options.toolCalls ?? [];
    this.toolResults = options.toolResults ?? [];
    this.usage = options.usage;
    this.meta = options.meta;
    this.messages = options.messages;
    this.additionalContent = options.additionalContent ?? {};
    this.raw = options.raw ?? null;
  }

  toObject(): JsonObject {
    return {
      steps: this.steps.map((step) => step.toObject()),
      text: this.text,
      finish_reason: this.finishReason,
      tool_calls: this.toolCalls.map((toolCall) => toolCall.toObject()),
      tool_results: this.toolResults.map((toolResult) => toolResult.toObject()),
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
      messages: this.messages.map((message) => message.toObject()),
      additional_content: { ...this.additionalContent },
      raw: this.raw === null ? null : { ...this.raw },
    };
  }
}

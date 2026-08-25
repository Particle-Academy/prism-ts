import type { JsonObject } from '../json.js';
import type { FinishReason } from '../enums.js';
import type { Message, SystemMessage } from '../value-objects/messages/index.js';
import type { Meta } from '../value-objects/meta.js';
import type { ToolCall } from '../value-objects/tool-call.js';
import type { ToolResult } from '../value-objects/tool-result.js';
import type { Usage } from '../value-objects/usage.js';

export interface TextStepOptions {
  text: string;
  finishReason: FinishReason;
  toolCalls?: readonly ToolCall[];
  toolResults?: readonly ToolResult[];
  /** Carried verbatim: provider-tool RESPONSES are outside this port's slice. */
  providerToolCalls?: readonly JsonObject[];
  usage: Usage;
  meta: Meta;
  messages?: readonly Message[];
  systemPrompts?: readonly SystemMessage[];
  additionalContent?: Readonly<JsonObject>;
  raw?: JsonObject | null;
  /** Carried verbatim: tool approval is outside this port's slice. */
  toolApprovalRequests?: readonly JsonObject[];
}

/** One round trip to the provider. */
export class TextStep {
  readonly text: string;

  readonly finishReason: FinishReason;

  readonly toolCalls: readonly ToolCall[];

  readonly toolResults: readonly ToolResult[];

  readonly providerToolCalls: readonly JsonObject[];

  readonly usage: Usage;

  readonly meta: Meta;

  readonly messages: readonly Message[];

  readonly systemPrompts: readonly SystemMessage[];

  readonly additionalContent: Readonly<JsonObject>;

  readonly raw: JsonObject | null;

  readonly toolApprovalRequests: readonly JsonObject[];

  constructor(options: TextStepOptions) {
    this.text = options.text;
    this.finishReason = options.finishReason;
    this.toolCalls = options.toolCalls ?? [];
    this.toolResults = options.toolResults ?? [];
    this.providerToolCalls = options.providerToolCalls ?? [];
    this.usage = options.usage;
    this.meta = options.meta;
    this.messages = options.messages ?? [];
    this.systemPrompts = options.systemPrompts ?? [];
    this.additionalContent = options.additionalContent ?? {};
    this.raw = options.raw ?? null;
    this.toolApprovalRequests = options.toolApprovalRequests ?? [];
  }

  toObject(): JsonObject {
    return {
      text: this.text,
      finish_reason: this.finishReason,
      tool_calls: this.toolCalls.map((toolCall) => toolCall.toObject()),
      tool_results: this.toolResults.map((toolResult) => toolResult.toObject()),
      provider_tool_calls: this.providerToolCalls.map((call) => ({ ...call })),
      usage: this.usage.toObject(),
      meta: this.meta.toObject(),
      messages: this.messages.map((message) => message.toObject()),
      system_prompts: this.systemPrompts.map((systemPrompt) => systemPrompt.toObject()),
      additional_content: { ...this.additionalContent },
      raw: this.raw === null ? null : { ...this.raw },
      tool_approval_requests: this.toolApprovalRequests.map((request) => ({ ...request })),
    };
  }
}

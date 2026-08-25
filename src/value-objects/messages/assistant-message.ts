import type { JsonObject } from '../../json.js';
import { isJsonObject } from '../../json.js';
import { ToolCall } from '../tool-call.js';

export class AssistantMessage {
  readonly type = 'assistant' as const;

  constructor(
    readonly content: string,
    readonly toolCalls: readonly ToolCall[] = [],
    readonly additionalContent: Readonly<JsonObject> = {},
    /**
     * Approval requests are carried verbatim rather than modelled: the approval
     * feature is not part of this port, but dropping the key would change what
     * `toObject()` emits relative to the reference, so it round-trips as raw
     * JSON instead.
     */
    readonly toolApprovalRequests: readonly JsonObject[] = [],
  ) {}

  toObject(): JsonObject {
    return {
      type: 'assistant',
      content: this.content,
      tool_calls: this.toolCalls.map((toolCall) => toolCall.toObject()),
      additional_content: { ...this.additionalContent },
      tool_approval_requests: this.toolApprovalRequests.map((request) => ({ ...request })),
    };
  }

  static fromObject(object: JsonObject): AssistantMessage {
    return new AssistantMessage(
      typeof object.content === 'string' ? object.content : '',
      (Array.isArray(object.tool_calls) ? object.tool_calls : [])
        .filter(isJsonObject)
        .map((toolCall) => ToolCall.fromObject(toolCall)),
      isJsonObject(object.additional_content) ? object.additional_content : {},
      (Array.isArray(object.tool_approval_requests) ? object.tool_approval_requests : []).filter(isJsonObject),
    );
  }
}

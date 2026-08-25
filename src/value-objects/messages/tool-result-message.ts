import type { JsonObject } from '../../json.js';
import { isJsonObject } from '../../json.js';
import { ToolResult } from '../tool-result.js';

export class ToolResultMessage {
  readonly type = 'tool_result' as const;

  constructor(
    readonly toolResults: readonly ToolResult[] = [],
    /** Carried verbatim; see the note on `AssistantMessage.toolApprovalRequests`. */
    readonly toolApprovalResponses: readonly JsonObject[] = [],
  ) {}

  toObject(): JsonObject {
    return {
      type: 'tool_result',
      tool_results: this.toolResults.map((toolResult) => toolResult.toObject()),
      tool_approval_responses: this.toolApprovalResponses.map((response) => ({ ...response })),
    };
  }

  static fromObject(object: JsonObject): ToolResultMessage {
    return new ToolResultMessage(
      (Array.isArray(object.tool_results) ? object.tool_results : [])
        .filter(isJsonObject)
        .map((toolResult) => ToolResult.fromObject(toolResult)),
      (Array.isArray(object.tool_approval_responses) ? object.tool_approval_responses : []).filter(isJsonObject),
    );
  }
}

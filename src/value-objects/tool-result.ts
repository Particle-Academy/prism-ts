import type { JsonObject, JsonValue } from '../json.js';
import { isJsonObject } from '../json.js';
import { Artifact } from './artifact.js';

export type ToolResultValue = string | number | JsonValue[] | JsonObject | null;

export class ToolResult {
  constructor(
    readonly toolCallId: string,
    readonly toolName: string,
    readonly args: Readonly<JsonObject>,
    readonly result: ToolResultValue,
    /**
     * The id the PROVIDER expects the result to be keyed by, which is not the
     * same as the id of the tool call that produced it.
     */
    readonly toolCallResultId: string | null = null,
    readonly artifacts: readonly Artifact[] = [],
  ) {}

  hasArtifacts(): boolean {
    return this.artifacts.length > 0;
  }

  toObject(): JsonObject {
    return {
      tool_call_id: this.toolCallId,
      tool_name: this.toolName,
      args: { ...this.args },
      result: this.result,
      tool_call_result_id: this.toolCallResultId,
      artifacts: this.artifacts.map((artifact) => artifact.toObject()),
    };
  }

  static fromObject(object: JsonObject): ToolResult {
    const result = object.result;

    return new ToolResult(
      typeof object.tool_call_id === 'string' ? object.tool_call_id : '',
      typeof object.tool_name === 'string' ? object.tool_name : '',
      isJsonObject(object.args) ? object.args : {},
      typeof result === 'string' || typeof result === 'number' || Array.isArray(result) || isJsonObject(result)
        ? result
        : null,
      typeof object.tool_call_result_id === 'string' ? object.tool_call_result_id : null,
      (Array.isArray(object.artifacts) ? object.artifacts : [])
        .filter(isJsonObject)
        .map((artifact) => Artifact.fromObject(artifact)),
    );
  }
}

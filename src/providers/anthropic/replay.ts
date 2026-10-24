import { isJsonObject, type JsonObject, type JsonValue } from '../../json.js';

const thinkingTypes = ['thinking', 'redacted_thinking'];

export function thinkingBlocks(blocks: readonly JsonValue[]): JsonObject[] {
  const objects = blocks.filter(isJsonObject);
  const fallback = lastFallbackIndex(objects);
  return objects.slice(fallback + 1).filter((block) => thinkingTypes.includes(String(block.type)));
}

/** Only content whose tools were answered can be stored as completed replay state. */
export function responseContentBlocks(blocks: readonly JsonValue[], keepServerToolUse = false): JsonObject[] {
  const objects = blocks.filter(isJsonObject);
  const answered = resultIds(objects);
  return objects.filter((block) => block.type !== 'tool_use'
    && (keepServerToolUse || !['server_tool_use', 'mcp_tool_use'].includes(String(block.type)) || answered.has(block.id)));
}

/** Follow the reference's fallback echo rules without interpreting signed data. */
export function replayContentBlocks(blocks: readonly JsonValue[]): JsonObject[] {
  const objects = blocks.filter(isJsonObject);
  const fallback = lastFallbackIndex(objects);
  const answered = resultIds(objects);
  return objects.filter((block, index) => index >= fallback
    || (!['thinking', 'redacted_thinking', 'connector_text', 'tool_use'].includes(String(block.type))
      && (block.type !== 'server_tool_use' || answered.has(block.id))))
    .map((block) => Array.isArray(block.input) && block.input.length === 0 ? { ...block, input: {} } : block);
}

function resultIds(blocks: readonly JsonObject[]): Set<JsonValue | undefined> {
  return new Set(blocks.filter((block) => typeof block.type === 'string' && block.type.endsWith('_tool_result'))
    .map((block) => block.tool_use_id).filter((id) => id !== undefined && id !== null));
}

function lastFallbackIndex(blocks: readonly JsonObject[]): number {
  let index = -1;
  for (const [candidate, block] of blocks.entries()) {
    if (block.type === 'fallback') index = candidate;
  }
  return index;
}

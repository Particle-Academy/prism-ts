import { isJsonObject, type JsonObject, type JsonValue } from '../../json.js';

/** Replay state is opaque; keep item order and all provider fields. */
export function replayableItems(output: readonly JsonValue[]): JsonObject[] {
  return output.filter(isJsonObject)
    .filter((item) => ['message', 'reasoning', 'function_call'].includes(String(item.type)))
    .map((item) => item.type === 'reasoning' && !Array.isArray(item.summary) && !isJsonObject(item.summary)
      ? { ...item, summary: [] } : item);
}

/** A completed non-tool turn must not replay unanswered calls or their reasoning. */
export function responseReplayItems(output: readonly JsonValue[]): JsonObject[] {
  const kept: JsonObject[] = [];
  let followedByKeptItem = false;
  for (const item of replayableItems(output).reverse()) {
    if (item.type === 'function_call') {
      followedByKeptItem = false;
      continue;
    }
    if (item.type === 'reasoning' && !followedByKeptItem) continue;
    followedByKeptItem = true;
    kept.push(item);
  }
  return kept.reverse();
}

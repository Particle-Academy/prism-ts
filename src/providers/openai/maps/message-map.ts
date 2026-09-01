import type { JsonValue } from '../../../json.js';
import { canonicalJson, isJsonObject } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import type { AssistantMessage, Message, SystemMessage, ToolResultMessage } from '../../../value-objects/messages/index.js';
import type { ToolCall } from '../../../value-objects/tool-call.js';
import type { ToolResultValue } from '../../../value-objects/tool-result.js';
import { mapDocument, mapImage } from './media-map.js';

/**
 * Map messages onto the Responses API's flat `input` array.
 *
 * Three things about this mapping are easy to get subtly wrong:
 *
 *   1. System prompts are PREPENDED to the message list rather than carried in
 *      a field of their own, and a system message maps to a BARE STRING content
 *      while a user message maps to a parts ARRAY. Two roles, two shapes, one
 *      payload.
 *   2. An assistant message's tool calls do not stay attached to it. Each one
 *      becomes its own top-level `function_call` item whose `arguments` is a
 *      JSON STRING — a JSON document nested inside a JSON document.
 *   3. A tool result is keyed by the RESULT id, not by the id of the call that
 *      produced it.
 *
 * @throws PrismError code `unknown_message_type`
 */
export function mapMessages(
  messages: readonly Message[],
  systemPrompts: readonly SystemMessage[] = [],
): JsonValue[] {
  const items: JsonValue[] = [];

  for (const message of [...systemPrompts, ...messages]) {
    switch (message.type) {
      case 'system':
        items.push({ role: 'system', content: message.content });
        break;
      case 'user':
        items.push({
          role: 'user',
          content: [
            { type: 'input_text', text: message.text() },
            ...message.images().map(mapImage),
            ...message.documents().map(mapDocument),
          ],
          // Spread at ITEM level: siblings of `role` and `content`, not nested.
          ...message.additionalAttributes,
        });
        break;
      case 'assistant':
        mapAssistantMessage(message, items);
        break;
      case 'tool_result':
        mapToolResultMessage(message, items);
        break;
      default:
        throw PrismError.unknownMessageType(describeMessage(message));
    }
  }

  return items;
}

function mapAssistantMessage(message: AssistantMessage, items: JsonValue[]): void {
  if (message.toolCalls.length > 0) {
    for (const [reasoningId, toolCalls] of groupByReasoningId(message.toolCalls)) {
      const first = toolCalls[0];

      if (reasoningId !== '' && first !== undefined) {
        items.push({
          type: 'reasoning',
          id: first.reasoningId,
          summary: first.reasoningSummary,
        });
      }

      for (const toolCall of toolCalls) {
        items.push({
          id: toolCall.id,
          call_id: toolCall.resultId,
          type: 'function_call',
          name: toolCall.name,
          arguments: canonicalJson(toolCall.parsedArguments()),
        });
      }
    }
  }

  // An assistant turn that carried only tool calls contributes NO assistant
  // item: an empty `output_text` part is rejected by the API.
  if (message.content !== '') {
    items.push({
      role: 'assistant',
      content: [{ type: 'output_text', text: message.content }],
    });
  }
}

function mapToolResultMessage(message: ToolResultMessage, items: JsonValue[]): void {
  for (const toolResult of message.toolResults) {
    items.push({
      type: 'function_call_output',
      call_id: toolResult.toolCallResultId,
      output: stringifyToolOutput(toolResult.result),
    });
  }
}

/** Calls that share a reasoning id travel together, behind one reasoning item. */
function groupByReasoningId(toolCalls: readonly ToolCall[]): Map<string, ToolCall[]> {
  const groups = new Map<string, ToolCall[]>();

  for (const toolCall of toolCalls) {
    const key = toolCall.reasoningId ?? '';
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [toolCall]);
    } else {
      group.push(toolCall);
    }
  }

  return groups;
}

/**
 * A string result is passed through UNTOUCHED — re-encoding it would wrap it in
 * quotes the model then has to see through. Only structured results are encoded.
 */
function stringifyToolOutput(result: ToolResultValue): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result === null) {
    return '';
  }

  if (Array.isArray(result) || isJsonObject(result)) {
    return canonicalJson(result);
  }

  return String(result);
}

/** Name whatever arrived, so the failure says which value it choked on. */
function describeMessage(message: unknown): string {
  const type: unknown = isJsonObject(message) ? message.type : undefined;

  return typeof type === 'string' ? type : String(type);
}

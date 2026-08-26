import type { JsonObject, JsonValue } from '../../../json.js';
import { canonicalJson, isJsonObject } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import type { AssistantMessage, Message, SystemMessage, ToolResultMessage } from '../../../value-objects/messages/index.js';
import type { ToolResultValue } from '../../../value-objects/tool-result.js';

/**
 * Map messages onto Anthropic's `messages` array.
 *
 * Anthropic differs from the Responses API in four ways that are easy to get
 * subtly wrong:
 *
 *   1. System prompts do NOT go in the message list. They are a top-level
 *      `system` field, which is why {@link mapSystem} exists separately — a
 *      system message pushed into `messages` is rejected outright.
 *   2. Tool calls stay ATTACHED to the assistant turn as `tool_use` content
 *      blocks. They do not become top-level items the way `function_call` does.
 *   3. A tool result is a USER turn containing `tool_result` blocks, keyed by
 *      `tool_use_id` — the id of the CALL, not of the result. That is the
 *      opposite of the Responses API, where the result id is the key.
 *   4. Turns must alternate. Consecutive tool results therefore travel as
 *      blocks inside ONE user turn rather than as several user turns.
 *
 * @throws PrismError code `unknown_message_type`
 */
export function mapMessages(messages: readonly Message[]): JsonValue[] {
  const items: JsonObject[] = [];

  for (const message of messages) {
    switch (message.type) {
      case 'system':
        // Reaching here means a system message was passed as a MESSAGE rather
        // than a system prompt. Anthropic has no system role, and silently
        // demoting it to a user turn would change what the model was told.
        throw PrismError.unknownMessageType('a system message in the message list; pass it as a system prompt');
      case 'user':
        items.push({
          role: 'user',
          content: [{ type: 'text', text: message.text() }],
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

/**
 * The top-level `system` field, or null when there is nothing to say.
 *
 * Several system prompts join with a blank line between them. Anthropic accepts
 * an array of blocks here too, but a joined string is what the reference sends
 * and the bytes are the contract.
 */
export function mapSystem(systemPrompts: readonly SystemMessage[]): string | null {
  const parts = systemPrompts.map((prompt) => prompt.content).filter((content) => content !== '');

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function mapAssistantMessage(message: AssistantMessage, items: JsonObject[]): void {
  const content: JsonValue[] = [];

  // Text first. Anthropic reads content blocks in order, and a tool_use ahead
  // of the reasoning that led to it reads as a model that decided first and
  // explained afterwards.
  if (message.content !== '') {
    content.push({ type: 'text', text: message.content });
  }

  for (const toolCall of message.toolCalls) {
    content.push({
      type: 'tool_use',
      // The CALL id. Anthropic echoes it back on the matching tool_result, and
      // a mismatch here is rejected rather than ignored.
      id: toolCall.id,
      name: toolCall.name,
      // An OBJECT, not a JSON string. The Responses API takes a document nested
      // inside a document; Anthropic takes the arguments themselves.
      input: toolCall.parsedArguments(),
    });
  }

  // An assistant turn with neither text nor tool calls contributes nothing —
  // Anthropic rejects an empty content array.
  if (content.length > 0) {
    items.push({ role: 'assistant', content });
  }
}

/**
 * Tool results become blocks in ONE user turn.
 *
 * Appended to the previous turn when that turn is already a user turn, because
 * Anthropic requires roles to alternate and two user turns in a row is a 400.
 */
function mapToolResultMessage(message: ToolResultMessage, items: JsonObject[]): void {
  const blocks: JsonValue[] = message.toolResults.map((toolResult) => ({
    type: 'tool_result',
    tool_use_id: toolResult.toolCallId,
    content: stringifyToolOutput(toolResult.result),
  }));

  if (blocks.length === 0) {
    return;
  }

  const previous = items[items.length - 1];

  if (previous !== undefined && previous.role === 'user' && Array.isArray(previous.content)) {
    previous.content = [...previous.content, ...blocks];

    return;
  }

  items.push({ role: 'user', content: blocks });
}

/** A tool's return value as text. Objects are canonicalised, not inspected. */
function stringifyToolOutput(result: ToolResultValue): string {
  return typeof result === 'string' ? result : canonicalJson(result as JsonValue);
}

function describeMessage(message: unknown): string {
  return isJsonObject(message) && typeof message.type === 'string' ? message.type : typeof message;
}

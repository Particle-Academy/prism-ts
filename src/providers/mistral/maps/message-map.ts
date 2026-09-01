import type { JsonObject, JsonValue } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import type { AssistantMessage, Message, SystemMessage, UserMessage } from '../../../value-objects/messages/index.js';
import { mapDocument, mapImage } from './media-map.js';

/**
 * Map messages onto Mistral's chat-completions shape.
 *
 * This is the OpenAI CHAT-COMPLETIONS format, not the Responses format the
 * OpenAI provider in this package speaks — roles are `system` / `user` /
 * `assistant` / `tool`, and a tool result is its own message keyed by
 * `tool_call_id`. The two look similar enough that sharing a mapper is tempting
 * and wrong: the Responses API takes `input` with typed content parts, and the
 * fields that differ are the ones that fail silently.
 *
 * System prompts come FIRST, matching the reference: Mistral weights the
 * earliest system turn most heavily, and a caller who set one expects it to
 * lead.
 *
 * @throws PrismError code `unknown_message_type`
 */
export function mapMessages(
  messages: readonly Message[],
  systemPrompts: readonly SystemMessage[],
): JsonObject[] {
  return [...systemPrompts, ...messages].flatMap(mapMessage);
}

function mapMessage(message: Message): JsonObject[] {
  switch (message.type) {
    case 'system':
      return [{ role: 'system', content: message.content }];
    case 'user':
      return [mapUserMessage(message)];
    case 'assistant':
      return [mapAssistantMessage(message)];
    case 'tool_result':
      // ONE message per result, not one carrying them all. Mistral matches each
      // back by `tool_call_id`, and a combined message has nowhere to put the
      // second id.
      return message.toolResults.map((result) => ({
        role: 'tool',
        content: result.result,
        tool_call_id: result.toolCallId,
      }));
    default:
      throw PrismError.unknownMessageType(String((message as { type: string }).type));
  }
}

/**
 * A user turn, always as a content ARRAY.
 *
 * Even for plain text, matching the reference. Mistral accepts a bare string
 * too, but sending the array shape unconditionally means adding an image part
 * later does not change the shape of every other message in a transcript — so a
 * stored conversation stays comparable with itself.
 *
 * Text leads, then images, then documents — the reference's order. Mistral does
 * not document an ordering requirement, but the parts reach the model in the
 * order they are sent, so keeping it identical to the reference means a
 * transcript compared across the two ports and the reference matches byte for
 * byte rather than only semantically.
 */
function mapUserMessage(message: UserMessage): JsonObject {
  const content: JsonValue[] = [
    { type: 'text', text: message.text() },
    ...message.images().map(mapImage),
    ...message.documents().map(mapDocument),
  ];

  return { role: 'user', content, ...message.additionalAttributes };
}

function mapAssistantMessage(message: AssistantMessage): JsonObject {
  const body: JsonObject = { role: 'assistant', content: message.content };

  if (message.toolCalls.length > 0) {
    body.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        // A JSON STRING, not an object — the chat-completions shape. An object
        // is accepted by some gateways and rejected by Mistral, which is the
        // worst kind of difference to carry. Already-string arguments are
        // passed through rather than re-encoded into a quoted string.
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
      },
    }));
  }

  return body;
}

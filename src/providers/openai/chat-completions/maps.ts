import type { JsonObject, JsonValue } from '../../../json.js';
import { canonicalJson } from '../../../json.js';
import { PrismError } from '../../../errors.js';
import { FinishReason, ToolChoice } from '../../../enums.js';
import { isTruthyByReferenceRules } from '../../../internal/filters.js';
import type { Tool } from '../../../tool.js';
import type { Image } from '../../../value-objects/media/image.js';
import type { AssistantMessage, Message, SystemMessage, UserMessage } from '../../../value-objects/messages/index.js';
import { replayableMessages } from '../../../value-objects/messages/replayable-messages.js';
import { dataUri } from '../../support/media.js';

/**
 * The OpenAI chat-completions mapping, ported from the reference's
 * `ChatCompletionsMessageMap`, `ChatCompletionsToolMap`,
 * `ChatCompletionsToolChoiceMap`, `ChatCompletionsImageMapper` and
 * `ChatCompletionsFinishReasonMap`.
 *
 * Deliberately NOT shared with Mistral's map, which speaks a near-identical
 * shape: the two references differ in small ways that change the bytes (a
 * user turn's extra attributes and documents, the key order of a tool
 * result, `any` versus `required`), and a shared mapper would carry whichever
 * one was edited last.
 */

/** System prompts first, then the conversation, as the reference merges them. */
export function mapChatMessages(messages: readonly Message[], systemPrompts: readonly SystemMessage[]): JsonObject[] {
  return [...systemPrompts, ...replayableMessages(messages)].flatMap(mapMessage);
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
      // One message per result, keyed in the reference's order.
      return message.toolResults.map((result) => ({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: result.result,
      }));
    default:
      throw PrismError.unknownMessageType(String((message as { type: string }).type));
  }
}

/**
 * A user turn: the text part first, then images, always as a content array.
 *
 * The reference's chat map has no place for a document, an audio or a video
 * part and drops them without a word, so the model answers about a file it
 * never saw. This port refuses them instead, before any request is sent.
 */
function mapUserMessage(message: UserMessage): JsonObject {
  const unsupported = message.media().find((part) => part.kind !== 'image');

  if (unsupported !== undefined) {
    throw PrismError.unsupportedMedia('OpenAI chat completions', unsupported.kind, 'text and images only');
  }

  return {
    role: 'user',
    content: [{ type: 'text', text: message.text() }, ...message.images().map(mapImage)],
  };
}

function mapImage(image: Image): JsonObject {
  if (!image.isUrl() && !image.hasBase64()) {
    throw PrismError.unsupportedMedia('OpenAI chat completions', 'image', 'a url, or bytes it can send as base64');
  }

  return {
    type: 'image_url',
    image_url: { url: image.isUrl() ? image.url : dataUri(image, 'OpenAI chat completions', 'image') },
  };
}

/**
 * An assistant turn, with the reference's `Payload::compact()`: an empty
 * `content` and an empty `tool_calls` are dropped, a literal `"0"` is kept.
 *
 * Arguments go out as a JSON STRING of the decoded object. `parsedArguments()`
 * refuses unusable arguments on a call nobody answered (G-341); an answered
 * one was already replaced by empty arguments in `replayableMessages()`.
 */
function mapAssistantMessage(message: AssistantMessage): JsonObject {
  const body: JsonObject = { role: 'assistant' };

  if (message.content !== '') {
    body.content = message.content;
  }

  if (message.toolCalls.length > 0) {
    body.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: canonicalJson(call.parsedArguments()) },
    }));
  }

  return body;
}

/** `null` for no tools, so the key is dropped rather than sent as `[]`. */
export function mapChatTools(tools: readonly Tool[]): JsonObject[] | null {
  if (tools.length === 0) {
    return null;
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name(),
      description: tool.description(),
      // PHP's `(bool)`: an empty list or map is not "strict".
      ...(isTruthyByReferenceRules(tool.providerOptions('strict')) ? { strict: true } : {}),
      parameters: tool.parametersAsSchema(true),
    },
  }));
}

/** A tool NAME becomes a function object; `Any` is spelled `required`. */
export function mapChatToolChoice(choice: string | ToolChoice | null): JsonValue | null {
  if (typeof choice === 'string') {
    return { type: 'function', function: { name: choice } };
  }

  switch (choice) {
    case ToolChoice.Auto:
      return 'auto';
    case ToolChoice.Any:
      return 'required';
    case ToolChoice.None:
      return 'none';
    default:
      return null;
  }
}

/** A missing reason is Unknown; an unrecognised one is Other, as the reference maps it. */
export function mapChatFinishReason(reason: JsonValue | undefined): FinishReason {
  if (reason === null || reason === undefined) {
    return FinishReason.Unknown;
  }

  switch (reason) {
    case 'stop':
      return FinishReason.Stop;
    case 'tool_calls':
      return FinishReason.ToolCalls;
    case 'length':
      return FinishReason.Length;
    case 'content_filter':
      return FinishReason.ContentFilter;
    default:
      return FinishReason.Other;
  }
}

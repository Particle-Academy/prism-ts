import type { JsonObject, JsonValue } from '../../../json.js';
import { whereNotNull } from '../../../internal/filters.js';
import { phpPrettyJson } from '../../../internal/php-json.js';
import type { StructuredRequest } from '../../../structured/request.js';
import type { TextRequest } from '../../../text/request.js';
import { SystemMessage } from '../../../value-objects/messages/index.js';
import { mapChatMessages, mapChatToolChoice, mapChatTools } from './maps.js';

/**
 * The three chat-completions bodies, ported from the reference's
 * `RequestPayloadMap::chatText()`, `chatStructured()` and `chatStream()`.
 *
 * They do NOT agree with each other on `max_tokens`, and that is copied rather
 * than tidied: the text body filters EVERY key on not-null, so an unset
 * `max_tokens` vanishes, while the structured and stream bodies merge it
 * unconditionally, so it goes out as an explicit `null`. Tidying either one
 * would change the bytes the cross-language corpus compares.
 */

export function buildChatTextBody(request: TextRequest): JsonObject {
  return whereNotNull({
    model: request.model(),
    messages: mapChatMessages(request.messages(), request.systemPrompts()),
    max_tokens: request.maxTokens(),
    temperature: request.temperature(),
    top_p: request.topP(),
    tools: mapChatTools(request.tools()),
    tool_choice: mapChatToolChoice(request.toolChoice()),
    verbosity: request.providerOptions('text_verbosity'),
  } satisfies Record<string, JsonValue | null | undefined>);
}

/**
 * `json_object` with the schema in an appended SYSTEM message, and no tools:
 * the reference's chat structured sender does not send them.
 */
export function buildChatStructuredBody(request: StructuredRequest): JsonObject {
  const messages = [...request.messages(), new SystemMessage(jsonInstruction(request))];

  return {
    model: request.model(),
    messages: mapChatMessages(messages, request.systemPrompts()),
    max_tokens: request.maxTokens(),
    ...whereNotNull({
      temperature: request.temperature(),
      top_p: request.topP(),
      response_format: { type: 'json_object' },
      verbosity: request.providerOptions('text_verbosity'),
    } satisfies Record<string, JsonValue | null | undefined>),
  };
}

/** `stream: true` LEADS, and there is no `stream_options`: the reference sends none. */
export function buildChatStreamBody(request: TextRequest): JsonObject {
  return {
    stream: true,
    model: request.model(),
    messages: mapChatMessages(request.messages(), request.systemPrompts()),
    max_tokens: request.maxTokens(),
    ...whereNotNull({
      temperature: request.temperature(),
      top_p: request.topP(),
      tools: mapChatTools(request.tools()),
      tool_choice: mapChatToolChoice(request.toolChoice()),
    } satisfies Record<string, JsonValue | null | undefined>),
  };
}

/** The reference's `appendJsonInstruction()`, byte for byte, PHP pretty print included. */
export function jsonInstruction(request: StructuredRequest): string {
  return `Respond with JSON that matches the following schema: \n ${phpPrettyJson(request.schema().toObject())}`;
}

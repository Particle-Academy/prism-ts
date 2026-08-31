import type { JsonObject, JsonValue } from '../../json.js';
import { whereNotNull } from '../../internal/filters.js';
import type { StructuredRequest } from '../../structured/request.js';
import type { TextRequest } from '../../text/request.js';
import { mapMessages } from './maps/message-map.js';
import { mapToolChoice } from './maps/tool-choice-map.js';
import { mapTools } from './maps/tool-map.js';

/**
 * Build the Mistral chat-completions request body.
 *
 * `model`, `messages` and `max_tokens` go in UNCONDITIONALLY, matching the
 * reference — so `max_tokens` is present as an explicit null on a request that
 * never set one. Everything else passes a NOT-NULL filter, so `0` and `false`
 * survive and only `null` is dropped: `withTemperature(0)` is a real setting.
 *
 * An empty tool list collapses to null BEFORE the filter, so the key vanishes.
 * An empty array is truthy in JavaScript, so a direct port sends `"tools":[]`,
 * which changes `tool_choice` defaults on some models and is rejected outright
 * by others.
 */
export function buildRequestBody(request: TextRequest): JsonObject {
  const tools = mapTools(request.tools());

  return {
    model: request.model(),
    messages: mapMessages(request.messages(), request.systemPrompts()),
    max_tokens: request.maxTokens(),
    ...whereNotNull({
      temperature: request.temperature(),
      top_p: request.topP(),
      reasoning_effort: request.providerOptions('reasoning_effort'),
      tools: tools.length > 0 ? tools : null,
      tool_choice: tools.length > 0 ? mapToolChoice(request.toolChoice()) : null,
    } satisfies Record<string, JsonValue | null | undefined>),
  };
}

/**
 * The same body, plus a schema — and never both a schema and tools.
 *
 * MISTRAL REFUSES `response_format` AND `tools` IN ONE REQUEST. The reference
 * works around it with a two-pass loop: send with tools, let the model call
 * them, then re-send without tools and with the schema to get the final JSON.
 *
 * This port does not run tools (the execution loop is deferred — see the parity
 * manifest), so there is no loop to two-pass. Tools are DROPPED here and the
 * schema is sent, which is the half that matters for `structured`: a caller who
 * declared tools on a structured request would otherwise get an error from the
 * provider naming a conflict they did not create.
 */
export function buildStructuredBody(request: StructuredRequest): JsonObject {
  const schema = request.schema();

  return {
    model: request.model(),
    messages: mapMessages(request.messages(), request.systemPrompts()),
    max_tokens: request.maxTokens(),
    response_format: {
      type: 'json_schema',
      json_schema: {
        schema: schema.toObject(),
        name: schema.name,
        // Mistral's own strict mode, so this IS enforced rather than requested
        // — unlike the Anthropic path, which can only ask. See G-08.
        strict: true,
      },
    },
    ...whereNotNull({
      temperature: request.temperature(),
      top_p: request.topP(),
      reasoning_effort: request.providerOptions('reasoning_effort'),
    } satisfies Record<string, JsonValue | null | undefined>),
  };
}

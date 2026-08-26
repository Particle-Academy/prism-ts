import type { JsonObject, JsonValue } from '../../json.js';
import { whereNotNull } from '../../internal/filters.js';
import type { TextRequest } from '../../text/request.js';
import { mapMessages, mapSystem } from './maps/message-map.js';
import { mapToolChoice } from './maps/tool-choice-map.js';
import { mapTools } from './maps/tool-map.js';

/**
 * Anthropic requires `max_tokens`, and has no documented default.
 *
 * The OpenAI body sends `max_output_tokens: null` for a request that never set
 * one; doing the same here is a 400. A number has to be chosen, so it is named
 * here rather than buried, and it is generous enough that hitting it means the
 * caller genuinely wanted a long answer and should say so.
 */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Build the Anthropic Messages API request body.
 *
 * The same two rules as the OpenAI body decide every key: `model`, `messages`
 * and `max_tokens` are merged UNCONDITIONALLY, and everything else goes through
 * a not-null filter, so `usingTemperature(0)` survives and only `null` is
 * dropped.
 *
 * What differs is `system`: it is a top-level field here, not a message, so
 * system prompts never enter `messages` at all.
 */
export function buildRequestBody(request: TextRequest): JsonObject {
  const body: JsonObject = {
    model: request.model(),
    messages: mapMessages(request.messages()),
    max_tokens: request.maxTokens() ?? DEFAULT_MAX_TOKENS,
  };

  const tools = mapTools(request.tools());

  const optional: Record<string, JsonValue | null | undefined> = {
    system: mapSystem(request.systemPrompts()),
    temperature: request.temperature(),
    top_p: request.topP(),
    top_k: request.topK(),
    // Collapsed to null BEFORE the filter, so the key vanishes rather than
    // sending an empty array — which changes tool_choice defaults.
    tools: tools.length > 0 ? tools : null,
    tool_choice: mapToolChoice(request.toolChoice()),
    // Extended thinking. Asymmetric like OpenAI's reasoning and for the same
    // reason: withReasoning(true) emits nothing, because a budget is a
    // per-provider setting the toggle must not invent. An explicit `thinking`
    // provider option wins.
    thinking: request.providerOptions('thinking') ?? null,
    metadata: request.providerOptions('metadata'),
    stop_sequences: request.providerOptions('stop_sequences'),
  };

  return { ...body, ...whereNotNull(optional) };
}

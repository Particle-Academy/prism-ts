import { isJsonObject } from '../../json.js';
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

/** Anthropic's minimum thinking budget, and the reference's default. */
const DEFAULT_THINKING_BUDGET = 1024;

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
  const effort = request.providerOptions('effort');

  const optional: Record<string, JsonValue | null | undefined> = {
    system: mapSystem(request.systemPrompts()),
    temperature: request.temperature(),
    top_p: request.topP(),
    top_k: request.topK(),
    // Collapsed to null BEFORE the filter, so the key vanishes rather than
    // sending an empty array — which changes tool_choice defaults.
    tools: tools.length > 0 ? tools : null,
    tool_choice: mapToolChoice(request.toolChoice()),
    thinking: resolveThinking(request),
    metadata: request.providerOptions('metadata'),
    stop_sequences: request.providerOptions('stop_sequences'),
    // `effort` is Prism's name for it; Anthropic reads it from output_config.
    // This port used to drop it while the reference sent it (G-57).
    output_config: isPresent(effort) ? { effort } : null,
  };

  return { ...body, ...whereNotNull(optional) };
}

/**
 * The `thinking` field, spelled the way the reference spells it.
 *
 * Asymmetric like OpenAI's reasoning and for the same reason: withReasoning(true)
 * emits nothing, because a budget is a per-provider setting the toggle must not
 * invent. withReasoning(false) does win over a `thinking` option, as it does in
 * the reference.
 *
 * `{ enabled: true, budgetTokens }` is Prism's spelling, not Anthropic's, and
 * becomes `{ type: 'enabled', budget_tokens }`. Sent as given it was a 400, so a
 * mode that worked in PHP failed here. A budget that is not an integer falls back
 * to 1024, Anthropic's minimum, as in the reference.
 *
 * Every other shape, `{ type: 'adaptive' }` included, is sent as given. The
 * reference keeps only `{ type: 'adaptive' }` and drops the rest; which way both
 * should go is open in G-57.
 */
function resolveThinking(request: TextRequest): JsonValue | null {
  if (request.reasoningEnabled() === false) {
    return null;
  }

  const thinking = request.providerOptions('thinking');

  if (isJsonObject(thinking) && thinking.type !== 'adaptive' && thinking.enabled === true) {
    const budget = thinking.budgetTokens;

    return {
      type: 'enabled',
      budget_tokens: typeof budget === 'number' && Number.isInteger(budget) ? budget : DEFAULT_THINKING_BUDGET,
    };
  }

  return thinking ?? null;
}

function isPresent(value: JsonValue | undefined): value is JsonValue {
  return value !== undefined && value !== null;
}

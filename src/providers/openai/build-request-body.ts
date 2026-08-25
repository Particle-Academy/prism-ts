import type { JsonObject, JsonValue } from '../../json.js';
import { isTruthyByReferenceRules, whereNotNull } from '../../internal/filters.js';
import type { TextRequest } from '../../text/request.js';
import { mapMessages } from './maps/message-map.js';
import { mapToolChoice } from './maps/tool-choice-map.js';
import { mapTools } from './maps/tool-map.js';

/**
 * Build the OpenAI Responses API request body.
 *
 * Two rules decide every key in here:
 *
 *   `model`, `input` and `max_output_tokens` are merged UNCONDITIONALLY. That
 *   is why `max_output_tokens` is present as an explicit `null` on a request
 *   that never set it — and why modelling "unset" as `undefined` would drop the
 *   key and change the bytes.
 *
 *   Everything else goes through a NOT-NULL filter. `false` and `0` survive it,
 *   so `usingTemperature(0)` is sent and a provider option of `store: false` is
 *   sent. Only `null` is dropped.
 *
 * The one place those two rules meet is `tools`: an empty tool list collapses to
 * `null` BEFORE the filter runs, so the key vanishes entirely. An empty array is
 * truthy in JavaScript, so a direct port sends `"tools":[]` — which some models
 * reject outright and which silently changes `tool_choice` defaults on others.
 */
export function buildRequestBody(request: TextRequest): JsonObject {
  const body: JsonObject = {
    model: request.model(),
    input: mapMessages(request.messages(), request.systemPrompts()),
    max_output_tokens: request.maxTokens(),
  };

  const tools = buildTools(request);
  const textVerbosity = request.providerOptions('text_verbosity');

  const optional: Record<string, JsonValue | null | undefined> = {
    temperature: request.temperature(),
    top_p: request.topP(),
    metadata: request.providerOptions('metadata'),
    tools: tools.length > 0 ? tools : null,
    tool_choice: mapToolChoice(request.toolChoice()),
    parallel_tool_calls: request.providerOptions('parallel_tool_calls'),
    previous_response_id: request.providerOptions('previous_response_id'),
    service_tier: request.providerOptions('service_tier'),
    store: request.providerOptions('store'),
    // Gated on truthiness rather than on null, unlike its neighbours: an empty
    // verbosity is not a verbosity.
    text: isTruthyByReferenceRules(textVerbosity) ? { verbosity: textVerbosity } : null,
    truncation: request.providerOptions('truncation'),
    // Asymmetric on purpose. `withReasoning(false)` asks OpenAI for minimal
    // effort; `withReasoning(true)` emits NOTHING, because enabling reasoning is
    // a per-provider setting and the toggle must not override it. An explicit
    // `reasoning` provider option wins over both.
    reasoning:
      request.providerOptions('reasoning') ?? (request.reasoningEnabled() === false ? { effort: 'minimal' } : null),
  };

  return { ...body, ...whereNotNull(optional) };
}

/** Provider-native tools are merged in FRONT of the caller's tools. */
export function buildTools(request: TextRequest): JsonValue[] {
  const tools = mapTools(request.tools());
  const providerTools = request.providerTools();

  if (providerTools.length === 0) {
    return tools;
  }

  return [
    ...providerTools.map((providerTool): JsonObject => ({ type: providerTool.type, ...providerTool.options })),
    ...tools,
  ];
}

import type { JsonObject } from '../../../json.js';
import type { Tool } from '../../../tool.js';

/**
 * Map tools onto Mistral's `tools` array.
 *
 * The chat-completions shape: a `function` object nested under a `type`, where
 * the Responses API flattens the same fields to the top level. `parameters` is
 * always sent, even empty — Mistral rejects a function declaration without one,
 * unlike OpenAI which treats it as optional.
 *
 * Declaration order is preserved. Tool order reaches the model and influences
 * which tool it picks.
 */
export function mapTools(tools: readonly Tool[]): JsonObject[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name(),
      description: tool.description(),
      parameters: {
        type: 'object',
        properties: tool.hasParameters() ? tool.parametersAsObject() : {},
        required: [...tool.requiredParameters()],
      },
    },
  }));
}

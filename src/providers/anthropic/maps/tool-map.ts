import type { JsonObject } from '../../../json.js';
import type { Tool } from '../../../tool.js';

/**
 * Map tools onto Anthropic's `tools` array.
 *
 * Anthropic names the schema field `input_schema`, not `parameters`, and it is
 * NOT optional the way OpenAI's is: a tool without one is rejected. So a
 * parameterless tool sends an empty object schema rather than omitting the key.
 *
 * Declaration order is preserved. Tool order reaches the model and influences
 * which tool it picks.
 */
export function mapTools(tools: readonly Tool[]): JsonObject[] {
  return tools.map((tool) => ({
    name: tool.name(),
    description: tool.description(),
    input_schema: {
      type: 'object',
      properties: tool.hasParameters() ? tool.parametersAsObject() : {},
      required: [...tool.requiredParameters()],
    },
  }));
}

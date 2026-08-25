import type { JsonObject, JsonValue } from '../../../json.js';
import { dropFalsy } from '../../../internal/filters.js';
import type { Tool } from '../../../tool.js';

/**
 * Map tools onto the Responses API's `tools` array.
 *
 * The whole mapped tool goes through a FALSINESS filter, not a not-null filter.
 * That is why `strict: false` never reaches the wire even though `store: false`
 * (a provider option, filtered on null) does. The inconsistency belongs to the
 * reference and is reproduced rather than tidied: tidying it would change the
 * bytes.
 *
 * Declaration order is preserved. Tool order reaches the model and influences
 * which tool it picks.
 */
export function mapTools(tools: readonly Tool[]): JsonObject[] {
  return tools.map((tool) => {
    const mapped: Record<string, JsonValue | undefined> = {
      type: 'function',
      name: tool.name(),
      description: tool.description(),
    };

    if (tool.hasParameters()) {
      mapped.parameters = {
        type: 'object',
        properties: tool.parametersAsObject(),
        // `required` may legitimately be empty — the falsiness filter only ever
        // runs over the TOP level of the mapped tool, never inside it.
        required: [...tool.requiredParameters()],
      };
    }

    mapped.strict = Boolean(tool.providerOptions('strict'));

    return dropFalsy(mapped);
  });
}

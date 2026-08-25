import type { JsonValue } from '../../../json.js';
import { ToolChoice } from '../../../enums.js';

/**
 * Map a tool choice onto its wire form.
 *
 * A choice given as a STRING is a tool name and becomes an object; a choice
 * given as an enum member becomes a bare string. Same argument, two JSON types.
 *
 * `Any` maps to `"required"` — the one member whose wire name differs from its
 * own name, and the reason serializing the enum directly would send `"any"` and
 * be rejected.
 */
export function mapToolChoice(toolChoice: string | ToolChoice | null): JsonValue | null {
  if (typeof toolChoice === 'string') {
    return { type: 'function', name: toolChoice };
  }

  switch (toolChoice) {
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

import type { JsonObject } from '../../../json.js';
import { ToolChoice } from '../../../enums.js';

/**
 * Map the shared tool choice onto Mistral's form.
 *
 * `auto` / `any` / `none` are BARE STRINGS, and a named tool is an object —
 * so the return type is a union rather than one or the other. Mistral spells
 * "the model must call something" as `any`, like Anthropic and unlike OpenAI's
 * `required`.
 */
export function mapToolChoice(choice: string | ToolChoice | null): string | JsonObject | null {
  if (choice === null) {
    return null;
  }

  if (choice === ToolChoice.Auto) {
    return 'auto';
  }

  if (choice === ToolChoice.Any) {
    return 'any';
  }

  if (choice === ToolChoice.None) {
    return 'none';
  }

  return { type: 'function', function: { name: String(choice) } };
}

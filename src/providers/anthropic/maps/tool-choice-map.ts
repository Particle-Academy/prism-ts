import type { JsonObject } from '../../../json.js';
import { ToolChoice } from '../../../enums.js';

/**
 * Map the shared tool choice onto Anthropic's object form.
 *
 * Anthropic takes an OBJECT where OpenAI takes a string, and it spells "the
 * model must call something" as `any` rather than `required`. A named tool is
 * `{ type: 'tool', name }`.
 */
export function mapToolChoice(choice: string | ToolChoice | null): JsonObject | null {
  if (choice === null) {
    return null;
  }

  if (choice === ToolChoice.Auto) {
    return { type: 'auto' };
  }

  if (choice === ToolChoice.Any) {
    return { type: 'any' };
  }

  if (choice === ToolChoice.None) {
    return { type: 'none' };
  }

  // Anything else names a tool.
  return { type: 'tool', name: String(choice) };
}

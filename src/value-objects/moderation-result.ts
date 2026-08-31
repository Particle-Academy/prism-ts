import { isJsonObject, type JsonObject } from '../json.js';

/**
 * One input's moderation verdict.
 *
 * `flagged` is the answer; `categories` and `categoryScores` are why. All three
 * are kept because a caller that acts on the boolean alone cannot explain the
 * decision to the person it was made about, and "your message was blocked" with
 * no reason is the worst version of this feature.
 */
export class ModerationResult {
  constructor(
    readonly flagged: boolean,
    readonly categories: Readonly<Record<string, boolean>> = {},
    readonly categoryScores: Readonly<Record<string, number>> = {},
  ) {}

  static fromObject(data: unknown): ModerationResult {
    const source = isJsonObject(data) ? data : {};

    return new ModerationResult(
      source.flagged === true,
      readBooleans(source.categories),
      readNumbers(source.category_scores),
    );
  }

  /** The categories that tripped, without the ones that did not. */
  flaggedCategories(): readonly string[] {
    return Object.entries(this.categories)
      .filter(([, tripped]) => tripped)
      .map(([name]) => name);
  }

  toObject(): JsonObject {
    return {
      flagged: this.flagged,
      categories: { ...this.categories },
      category_scores: { ...this.categoryScores },
    };
  }
}

/**
 * Non-boolean and non-numeric members are DROPPED, not coerced.
 *
 * A category whose value arrived as a string would become `true` under
 * coercion — including the string `"false"` — and this is the one value object
 * in the port where a wrong `true` means content gets blocked.
 */
function readBooleans(value: unknown): Record<string, boolean> {
  const source = isJsonObject(value) ? value : {};
  const result: Record<string, boolean> = {};

  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'boolean') {
      result[key] = entry;
    }
  }

  return result;
}

function readNumbers(value: unknown): Record<string, number> {
  const source = isJsonObject(value) ? value : {};
  const result: Record<string, number> = {};

  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'number') {
      result[key] = entry;
    }
  }

  return result;
}

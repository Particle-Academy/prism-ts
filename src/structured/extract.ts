import type { JsonObject } from '../json.js';
import { isJsonObject } from '../json.js';

/**
 * Make an object out of what the model said, or report that you could not.
 *
 * RETURNS NULL, NEVER THROWS. A model asked for JSON can answer with a refusal,
 * an apology, or a correct object wrapped in commentary, and none of those is an
 * exception — they are answers of a shape the caller did not want. Throwing here
 * would destroy `text`, which is the only evidence of what actually happened and
 * the only thing that explains the failure to whoever reads the log.
 *
 * Two attempts, in order:
 *
 *   1. Parse the whole string. This is the case that should happen.
 *   2. Parse the contents of the FIRST fenced block. Models fence JSON even when
 *      told not to, and the reference's own Anthropic prompt pleads against it
 *      ("not in backticks or a code block") — a plea is not a guarantee.
 *
 * A JSON array or a bare scalar parses successfully and is still rejected: the
 * schema describes an object, and returning `[1,2,3]` as "structured" would
 * satisfy the type and break the first caller to read a property off it.
 */
export function extractStructured(text: string): JsonObject | null {
  const direct = parseObject(text);

  if (direct !== null) {
    return direct;
  }

  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);

  return fenced === null ? null : parseObject(fenced[1] ?? '');
}

function parseObject(candidate: string): JsonObject | null {
  const trimmed = candidate.trim();

  if (trimmed === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);

    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

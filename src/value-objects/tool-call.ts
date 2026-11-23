import type { JsonObject, JsonValue } from '../json.js';
import { isJsonObject } from '../json.js';
import { PrismError } from '../errors.js';

/**
 * A tool call's arguments arrive either already decoded, or as the raw JSON
 * string the provider streamed. Both are kept as-is; `parsedArguments()` is the
 * one place the string form is decoded.
 */
export type ToolCallArguments = string | JsonObject;

export class ToolCall {
  readonly id: string;

  readonly name: string;

  readonly arguments: ToolCallArguments;

  readonly resultId: string | null;

  readonly reasoningId: string | null;

  readonly reasoningSummary: JsonValue[] | null;

  constructor(
    id: string,
    name: string,
    args: ToolCallArguments,
    resultId: string | null = null,
    reasoningId: string | null = null,
    reasoningSummary: JsonValue[] | null = null,
  ) {
    // `arguments` cannot be a constructor parameter name — class bodies are
    // always strict mode, where `arguments` is not a legal binding — so the
    // field is assigned rather than declared as a parameter property.
    this.id = id;
    this.name = name;
    this.arguments = args;
    this.resultId = resultId;
    this.reasoningId = reasoningId;
    this.reasoningSummary = reasoningSummary;
  }

  /**
   * The arguments as an object.
   *
   * An empty string and the string `'0'` both decode to `{}` — the reference
   * short-circuits on falsiness before it ever calls its JSON decoder, and both
   * of those are falsy there. A JSON `null` and an empty list also mean none
   * were given. Anything else that is not a map of named values is refused
   * rather than read as no arguments, so a tool is never run on an empty object
   * the model did not send.
   *
   * @throws PrismError code `malformed_tool_call_arguments`
   */
  parsedArguments(): JsonObject {
    if (this.arguments === '' || this.arguments === '0') {
      return {};
    }

    const decoded: unknown = typeof this.arguments === 'string' ? this.#decode(this.arguments) : this.arguments;

    if (decoded === null || (Array.isArray(decoded) && decoded.length === 0)) {
      return {};
    }

    // Integer-like keys are refused because the reference binds them to a
    // handler by position, and all three languages classify a call the same way.
    if (!isJsonObject(decoded) || Object.keys(decoded).some(isIntegerKey)) {
      throw PrismError.toolCallArgumentsNotAnObject(this.name);
    }

    return decoded;
  }

  /** Whether `parsedArguments()` would refuse these arguments. */
  hasMalformedArguments(): boolean {
    try {
      this.parsedArguments();

      return false;
    } catch (error) {
      if (error instanceof PrismError && error.code === 'malformed_tool_call_arguments') {
        return true;
      }

      throw error;
    }
  }

  /** This call with unusable arguments replaced by none; a valid call is unchanged. */
  withoutMalformedArguments(): ToolCall {
    if (!this.hasMalformedArguments()) {
      return this;
    }

    return new ToolCall(this.id, this.name, {}, this.resultId, this.reasoningId, this.reasoningSummary);
  }

  #decode(text: string): unknown {
    let decoded: unknown;

    try {
      decoded = JSON.parse(text);
    } catch (error) {
      // Some providers emit raw control characters inside string values, which
      // RFC 8259 requires to be escaped. Escape them in place — rather than
      // stripping them, which would corrupt intentional newlines and tabs — and
      // decode again.
      try {
        decoded = JSON.parse(escapeControlCharactersInStrings(text));
      } catch (retryError) {
        throw PrismError.malformedToolCallArguments(this.name, retryError ?? error);
      }
    }

    if (!decodesInEveryLanguage(decoded)) {
      throw PrismError.malformedToolCallArguments(this.name);
    }

    return decoded;
  }

  toObject(): JsonObject {
    return {
      id: this.id,
      name: this.name,
      arguments: this.arguments,
      result_id: this.resultId,
      reasoning_id: this.reasoningId,
      reasoning_summary: this.reasoningSummary,
    };
  }

  static fromObject(object: JsonObject): ToolCall {
    const args = object.arguments;

    return new ToolCall(
      typeof object.id === 'string' ? object.id : '',
      typeof object.name === 'string' ? object.name : '',
      typeof args === 'string' || isJsonObject(args) ? args : '',
      typeof object.result_id === 'string' ? object.result_id : null,
      typeof object.reasoning_id === 'string' ? object.reasoning_id : null,
      Array.isArray(object.reasoning_summary) ? object.reasoning_summary : null,
    );
  }
}

const MAX_JSON_DEPTH = 511;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * The reference's decoder refuses a lone surrogate and nesting past 511 levels.
 * Walked with a stack, so deep input cannot overflow the call stack here.
 */
function decodesInEveryLanguage(root: unknown): boolean {
  const pending: [unknown, number][] = [[root, 1]];

  while (pending.length > 0) {
    const [value, depth] = pending.pop() as [unknown, number];

    if (typeof value === 'string') {
      if (LONE_SURROGATE.test(value)) return false;
      continue;
    }

    if (typeof value !== 'object' || value === null) continue;
    if (depth > MAX_JSON_DEPTH) return false;

    if (Array.isArray(value)) {
      for (const item of value) pending.push([item, depth + 1]);
      continue;
    }

    for (const [key, item] of Object.entries(value)) {
      if (LONE_SURROGATE.test(key)) return false;
      pending.push([item, depth + 1]);
    }
  }

  return true;
}

/** A key PHP would store as an integer: canonical decimal, within 64 bits. */
function isIntegerKey(key: string): boolean {
  if (!/^(0|-?[1-9][0-9]*)$/.test(key)) {
    return false;
  }

  const value = BigInt(key);

  return value >= -9223372036854775808n && value <= 9223372036854775807n;
}

/**
 * Escape raw control characters (0x00–0x1F) that appear inside JSON string
 * literals, and drop the ones that appear outside strings where they can never
 * be valid (raw tab, newline and carriage return between tokens are legal
 * whitespace and are kept).
 */
function escapeControlCharactersInStrings(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const char of json) {
    const code = char.codePointAt(0) ?? 0;

    if (code <= 0x1f) {
      if (inString) {
        result += CONTROL_ESCAPES[char] ?? `\\u${code.toString(16).padStart(4, '0')}`;
      } else if (char === '\t' || char === '\n' || char === '\r') {
        result += char;
      }

      escaped = false;

      continue;
    }

    result += char;

    if (escaped) {
      escaped = false;
    } else if (inString && char === '\\') {
      escaped = true;
    } else if (char === '"') {
      inString = !inString;
    }
  }

  return result;
}

const CONTROL_ESCAPES: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

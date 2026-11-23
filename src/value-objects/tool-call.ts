import type { JsonObject, JsonValue } from '../json.js';
import { canonicalJson, isJsonObject } from '../json.js';
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

    // Admitted only if a follow-up request can carry it, in any language.
    if (!canBeSentBack(decoded)) {
      throw PrismError.malformedToolCallArguments(this.name);
    }

    return decoded;
  }

  /**
   * A provider's value as this class stores it. Null means none were given.
   * Any other value that is neither text nor a map is held as a one-item list,
   * the one form that is refused whatever the value was: `0` and `false` must
   * not turn into "no arguments" on the way in.
   */
  static storableArguments(value: unknown): ToolCallArguments {
    if (typeof value === 'string' || isJsonObject(value)) return value;
    if (value === null || value === undefined) return '';
    if (Array.isArray(value) && value.length === 0) return '[]';

    return JSON.stringify([value]);
  }

  /**
   * The accumulated text once a streamed fragment is added. A fragment that is
   * not text makes the whole value unreadable, wherever it arrived: a leading
   * `]` can never become valid JSON, whatever is appended after it.
   */
  static appendArgumentFragment(text: string, fragment: unknown): string {
    if (fragment === null || fragment === undefined) return text;

    return typeof fragment === 'string' ? text + fragment : `]${text}`;
  }

  /**
   * The arguments as text for a provider field that carries them as written:
   * the original text when it is valid JSON naming values, otherwise the same
   * value encoded, and `{}` for no arguments or unusable ones.
   */
  replayableArgumentsText(): string {
    if (typeof this.arguments === 'string' && !this.hasMalformedArguments() && Object.keys(this.parsedArguments()).length > 0) {
      try {
        JSON.parse(this.arguments);

        return this.arguments;
      } catch {
        // Valid only after repair, so it is sent encoded.
      }
    }

    return canonicalJson(this.withoutMalformedArguments().parsedArguments());
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
      ToolCall.storableArguments(args),
      typeof object.result_id === 'string' ? object.result_id : null,
      typeof object.reasoning_id === 'string' ? object.reasoning_id : null,
      Array.isArray(object.reasoning_summary) ? object.reasoning_summary : null,
    );
  }
}

/**
 * The deepest nesting accepted. A provider wraps the arguments in its own
 * request envelope, and the reference encodes that request with a depth limit
 * of 512, so the limit leaves room for the deepest envelope.
 */
const MAX_ARGUMENT_DEPTH = 500;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Whether a decoded value survives the encode a follow-up request uses, in
 * every language: no non-finite number, no key starting with NUL, no lone
 * surrogate, and no deeper than the limit. Walked a level at a time, so deep
 * input cannot overflow the call stack, and only nested values are held.
 */
function canBeSentBack(root: JsonObject): boolean {
  let level: object[] = [root];

  for (let depth = 1; level.length > 0; depth++) {
    const next: object[] = [];

    for (const value of level) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!admitsValue(item, depth, next)) return false;
        }

        continue;
      }

      const map = value as Record<string, unknown>;

      for (const key of Object.keys(map)) {
        if (key.startsWith('\u0000') || LONE_SURROGATE.test(key)) return false;
        if (!admitsValue(map[key], depth, next)) return false;
      }
    }

    level = next;
  }

  try {
    canonicalJson(root);
  } catch {
    return false;
  }

  return true;
}

/** Checks a scalar in place and holds only a nested value for the next level. */
function admitsValue(item: unknown, depth: number, next: object[]): boolean {
  if (typeof item === 'number') return Number.isFinite(item);
  if (typeof item === 'string') return !LONE_SURROGATE.test(item);
  if (typeof item !== 'object' || item === null) return true;
  if (depth >= MAX_ARGUMENT_DEPTH) return false;

  next.push(item);

  return true;
}

/** A key PHP would store as an integer: canonical decimal, within 64 bits. */
function isIntegerKey(key: string): boolean {
  // Twenty characters is the longest 64-bit integer, with its sign.
  if (key.length > 20 || !/^(0|-?[1-9][0-9]*)$/.test(key)) {
    return false;
  }

  const value = BigInt(key);

  return value >= -9223372036854775808n && value <= 9223372036854775807n;
}

/**
 * Escape raw control characters (0x00–0x1F) that appear inside JSON string
 * literals. Anything else is left as it is, so that the decode refuses it: a
 * control character outside a string, or straight after a backslash, has no
 * value it can be repaired to.
 */
function escapeControlCharactersInStrings(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const char of json) {
    const code = char.codePointAt(0) ?? 0;

    if (code <= 0x1f) {
      result += inString && !escaped
        ? CONTROL_ESCAPES[char] ?? `\\u${code.toString(16).padStart(4, '0')}`
        : char;

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

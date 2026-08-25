/**
 * Canonical JSON — the ONE serialization used both for the HTTP request body
 * and for conformance comparison.
 *
 * Canonical form:
 *   - UTF-8, no insignificant whitespace
 *   - forward slashes NOT escaped
 *   - non-ASCII NOT escaped
 *   - object keys in insertion order, never sorted
 *
 * `JSON.stringify` already satisfies all four when called with no replacer and
 * no space argument, so the encoder is deliberately thin. What it adds is a
 * guard: `JSON.stringify` SILENTLY DROPS object properties whose value is
 * `undefined` and silently rewrites `undefined` array elements to `null`. In
 * this port `null` and absent are different — `max_output_tokens` is emitted as
 * an explicit `null` when unset — so a stray `undefined` is a bug, not a
 * shorthand for "omit this". The encoder refuses to encode one.
 */

import { PrismError } from './errors.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Encode a value to its canonical JSON string.
 *
 * @throws PrismError code `canonical_json_unencodable` when the value contains
 *   `undefined`, a function or a symbol anywhere inside it — every one of which
 *   `JSON.stringify` would drop or rewrite without complaint.
 */
export function canonicalJson(value: JsonValue): string {
  assertEncodable(value, '$');

  return JSON.stringify(value);
}

function assertEncodable(value: unknown, path: string): void {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw PrismError.canonicalJsonUnencodable(path, value);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertEncodable(item, `${path}[${index}]`);
    });

    return;
  }

  if (isJsonObject(value)) {
    // Object.entries walks own enumerable string keys in insertion order. The
    // one exception is array-index-like keys ("0", "1", …), which every JS
    // engine hoists to the front; no key in this port's payloads is one.
    for (const [key, item] of Object.entries(value)) {
      assertEncodable(item, `${path}.${key}`);
    }
  }
}

/**
 * Read a dotted path out of a JSON object.
 *
 * Used only for provider options, where the reference reaches for Laravel's
 * `data_get`. This is deliberately NOT a `data_get` clone: no wildcards, no
 * `{first}` / `{last}`, no collection support. Missing paths return `undefined`.
 */
export function getByPath(source: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = source;

  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      current = Number.isInteger(index) ? current[index] : undefined;

      continue;
    }

    if (!isJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

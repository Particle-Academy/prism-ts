/**
 * The two filters the OpenAI request body is built with — and they do NOT agree.
 *
 * `whereNotNull` drops only null. `false` and `0` survive it, which is why
 * `usingTemperature(0)` and a provider option of `store: false` both reach the
 * wire.
 *
 * `dropFalsy` drops everything the REFERENCE language considers falsy, which is
 * a strictly larger set: `false`, `0`, `''`, the string `'0'`, and — the trap
 * for every port — the EMPTY ARRAY, which is truthy in JavaScript. It is used
 * for exactly one thing, mapping a tool, which is why `strict: false` never
 * reaches the wire while `store: false` does.
 *
 * That inconsistency is the reference's. It is reproduced here rather than
 * tidied, because tidying it would change the bytes on the wire.
 */

import type { JsonObject, JsonValue } from '../json.js';
import { isJsonObject } from '../json.js';

/** Drop null and undefined entries, preserving insertion order. */
export function whereNotNull(entries: Record<string, JsonValue | null | undefined>): JsonObject {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Falsiness as the reference language defines it.
 *
 * Empty arrays and empty objects are falsy here. In the reference both are the
 * same construct — an empty array — so they cannot be told apart, and neither
 * one ever survives its filter.
 */
export function isTruthyByReferenceRules(value: JsonValue | undefined): value is JsonValue {
  if (value === undefined || value === null || value === false) {
    return false;
  }

  if (value === true) {
    return true;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return value !== '' && value !== '0';
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return Object.keys(value).length > 0;
}

/** Drop every falsy entry, preserving insertion order. */
export function dropFalsy(entries: Record<string, JsonValue | undefined>): JsonObject {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(entries)) {
    if (isTruthyByReferenceRules(value)) {
      result[key] = value;
    }
  }

  return result;
}

/** Read a string off a raw provider payload, falling back when it is anything else. */
export function readString(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Read a number off a raw provider payload, falling back when it is anything else. */
export function readNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Read a nullable number off a raw provider payload. */
export function readNullableNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Narrow a raw payload value to an object, or `null` when it is anything else. */
export function readObject(value: JsonValue | undefined): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

/** Narrow a raw payload value to an array, or `[]` when it is anything else. */
export function readArray(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

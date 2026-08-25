import { describe, expect, it } from 'vitest';
import { PrismError, canonicalJson, getByPath, isJsonObject } from '../src/index.js';
import type { JsonObject } from '../src/index.js';

describe('canonicalJson', () => {
  it('keeps an explicit null and treats an omitted key as absent', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson({})).toBe('{}');
  });

  it('refuses to encode undefined rather than silently dropping the key', () => {
    // This is the whole point of the guard. JSON.stringify({ a: undefined })
    // returns "{}" — the key disappears and nobody is told.
    const value = { a: undefined } as unknown as JsonObject;

    expect(() => canonicalJson(value)).toThrowError(PrismError);
    expect(() => canonicalJson(value)).toThrowError(/undefined/);

    try {
      canonicalJson(value);
    } catch (error) {
      expect((error as PrismError).code).toBe('canonical_json_unencodable');
    }
  });

  it('refuses to encode undefined nested inside an array', () => {
    // JSON.stringify would rewrite this element to null, changing the payload.
    const value = { a: [1, undefined, 3] } as unknown as JsonObject;

    expect(() => canonicalJson(value)).toThrowError(/\$\.a\[1\]/);
  });

  it('refuses functions and symbols, which stringify also drops', () => {
    expect(() => canonicalJson({ a: () => 1 } as unknown as JsonObject)).toThrowError(PrismError);
    expect(() => canonicalJson({ a: Symbol('x') } as unknown as JsonObject)).toThrowError(PrismError);
  });

  it('does not escape forward slashes or non-ASCII', () => {
    expect(canonicalJson({ text: 'https://example.com/über — 日本語' })).toBe(
      '{"text":"https://example.com/über — 日本語"}',
    );
  });

  it('emits object keys in insertion order, never sorted', () => {
    expect(canonicalJson({ zebra: 1, alpha: 2, model: 3 })).toBe('{"zebra":1,"alpha":2,"model":3}');
  });

  it('emits no insignificant whitespace', () => {
    expect(canonicalJson({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it('renders an integral float the same as an integer', () => {
    expect(canonicalJson({ temperature: 1.0 })).toBe('{"temperature":1}');
    expect(canonicalJson({ temperature: 0.7 })).toBe('{"temperature":0.7}');
  });

  it('distinguishes false and zero from null', () => {
    expect(canonicalJson({ store: false, temperature: 0, missing: null })).toBe(
      '{"store":false,"temperature":0,"missing":null}',
    );
  });
});

describe('isJsonObject', () => {
  it('accepts plain objects and rejects arrays and null', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject('a')).toBe(false);
  });
});

describe('getByPath', () => {
  it('reads dotted paths and returns undefined for anything missing', () => {
    const source: JsonObject = { a: { b: { c: 1 } }, list: [{ d: 2 }] };

    expect(getByPath(source, 'a.b.c')).toBe(1);
    expect(getByPath(source, 'list.0.d')).toBe(2);
    expect(getByPath(source, 'a.b.missing')).toBeUndefined();
    expect(getByPath(source, 'nope.at.all')).toBeUndefined();
  });
});

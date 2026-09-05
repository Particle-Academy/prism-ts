import { describe, expect, it, vi, afterEach } from 'vitest';
import { foldHeaderName, foldHeaderNames } from '../src/http/header-names.js';
import { parseRateLimits as anthropicLimits } from '../src/providers/anthropic/rate-limits.js';
import { parseRateLimits as mistralLimits } from '../src/providers/mistral/rate-limits.js';
import { parseRateLimits as openaiLimits } from '../src/providers/openai/rate-limits.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('folding an HTTP field name', () => {
  it('folds an ASCII name the way HTTP compares one', () => {
    expect(foldHeaderName('Anthropic-RateLimit-Requests-Limit')).toBe(
      'anthropic-ratelimit-requests-limit',
    );
  });

  it('keeps the order the headers arrived in', () => {
    // Bucket order is part of the answer these readers give, and nothing errors
    // when it changes — a caller reading `rateLimits[0]` simply gets a
    // different bucket.
    expect(Object.keys(foldHeaderNames({ 'B-Second': '2', 'A-First': '1' }))).toEqual([
      'b-second',
      'a-first',
    ]);
  });

  it('will not fold a lookalike codepoint into a real bucket name', () => {
    // THE REASON THIS IS NOT toLowerCase(). U+212A KELVIN SIGN folds to a plain
    // ASCII `k` under a Unicode-aware fold, so this name would come back as
    // `anthropic-ratelimit-tokens-limit` and manufacture a `tokens` bucket —
    // the name a caller matches on to decide whether it has token quota left —
    // out of a header the provider never sent.
    const name = 'anthropic-ratelimit-to\u212Aens-limit';

    expect(foldHeaderName(name)).toBe(name);
    expect(name.toLowerCase()).toBe('anthropic-ratelimit-tokens-limit');
  });

  it('never changes the length of a name, which a Unicode fold does', () => {
    // U+0130 folds to TWO codepoints (`i` + U+0307). The bucket name derived
    // from the header would then be a different string in each of the three
    // languages implementing this parser — a cross-language divergence produced
    // by the fix rather than removed by it.
    const name = 'anthropic-ratelimit-\u0130nput-tokens-limit';

    expect(foldHeaderName(name)).toHaveLength(name.length);
    expect(name.toLowerCase().length).toBeGreaterThan(name.length);
  });
});

describe('reading quota through a title-casing gateway', () => {
  // HTTP field names are case-insensitive (RFC 9110 §5.1) and a gateway that
  // title-cases them is ordinary rather than hostile. These lookups used to be
  // exact object keys against the wire case, so such a proxy made every reader
  // return an empty array — which is also what a response that legitimately
  // carried no quota headers looks like.
  it('reads Anthropic quota', () => {
    const limits = anthropicLimits({
      'Anthropic-RateLimit-Requests-Limit': '1000',
      'Anthropic-RateLimit-Requests-Remaining': '500',
      'Anthropic-RateLimit-Requests-Reset': '2026-08-25T11:15:30Z',
    });

    expect(limits).toHaveLength(1);
    expect(limits[0]?.name).toBe('requests');
    expect(limits[0]?.limit).toBe(1000);
    expect(limits[0]?.resetsAt?.toISOString()).toBe('2026-08-25T11:15:30.000Z');
  });

  it('reads OpenAI quota', () => {
    const limits = openaiLimits({
      'X-RateLimit-Limit-Tokens': '200000',
      'X-RateLimit-Remaining-Tokens': '199000',
      'X-RateLimit-Reset-Tokens': '30s',
    });

    expect(limits).toHaveLength(1);
    expect(limits[0]?.name).toBe('tokens');
    expect(limits[0]?.limit).toBe(200_000);
  });

  it('reads Mistral quota', () => {
    const limits = mistralLimits({
      'RateLimitBySize-Limit': '500000',
      'RateLimitBySize-Remaining': '499900',
    });

    expect(limits).toHaveLength(1);
    expect(limits[0]?.name).toBe('tokens');
  });
});

describe("Mistral's headers, under the names the service actually sends", () => {
  it('reads ratelimitbysize-limit, which has NO bucket segment', () => {
    // G-41. This reader used to expect `ratelimitbysize-limit-tokens`, so a real
    // Mistral response produced an empty array on every call —
    // indistinguishable from a provider that sent no quota headers at all. Its
    // own tests could not see it: they fed the parser the names the parser
    // expected. `prism-parity`'s cross-language corpus (prl-0014) could.
    vi.useFakeTimers();
    vi.setSystemTime(1_787_656_500 * 1000);

    const limits = mistralLimits({
      'ratelimitbysize-limit': '500000',
      'ratelimitbysize-remaining': '499900',
      'ratelimitbysize-reset': '28',
    });

    expect(limits).toHaveLength(1);
    expect(limits[0]?.name).toBe('tokens');
    expect(limits[0]?.limit).toBe(500_000);
    expect(limits[0]?.remaining).toBe(499_900);
    // A DURATION in seconds, added to now — not a timestamp.
    expect(limits[0]?.resetsAt?.toISOString()).toBe('2026-08-25T11:15:28.000Z');
  });

  it('reports nothing when Mistral reported nothing', () => {
    // The reference emits this bucket unconditionally and casts the absent
    // headers, so it answers limit 0, remaining 0, resets now: a provider that
    // said nothing, reported as exhausted and ready to retry immediately.
    expect(mistralLimits({ 'content-type': 'application/json' })).toEqual([]);
  });

  it('does not answer a per-bucket spelling the service does not send', () => {
    // The old names. Keeping them as a fallback would give this port a bucket
    // where the reference and prism-py give none — a new divergence introduced
    // by the fix for an old one.
    expect(
      mistralLimits({
        'ratelimitbysize-limit-tokens': '500000',
        'ratelimitbysize-remaining-tokens': '499900',
      }),
    ).toEqual([]);
  });
});

/**
 * Comparing an HTTP field name the way HTTP defines it: without regard to case.
 *
 * Field names are case-insensitive (RFC 9110 §5.1), and a gateway that
 * title-cases them is ordinary rather than hostile. Every rate-limit reader
 * here looks its headers up as exact object keys, so a single such proxy in
 * front of the provider made `parseRateLimits` return an EMPTY ARRAY — which is
 * also exactly what a response that legitimately carried no quota headers looks
 * like. The failure was therefore invisible when it happened and permanent
 * afterwards.
 *
 * **The fold is deliberately ASCII-only, and that is the whole subtlety here.**
 * `String.prototype.toLowerCase()` is Unicode-aware: `K` (U+212A KELVIN SIGN)
 * folds to a plain `k`, so `anthropic-ratelimit-to<U+212A>ens-limit` would come
 * back as a bucket named `tokens` — the name a caller matches on to decide
 * whether it has token quota left, manufactured from a header the provider
 * never sent. `İ` (U+0130) folds to TWO codepoints, changing the string's
 * length under the offset arithmetic that splits a bucket from a field.
 *
 * An HTTP field name is a `token` — ASCII by grammar — so a codepoint range
 * over the 26 ASCII letters is both the correct fold and the only one the
 * sibling ports (`prism`, `prism-py`) can reproduce byte for byte.
 */

/** One field name, folded to lower case as ASCII and nothing else. */
export function foldHeaderName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/**
 * A header map re-keyed by folded name, values untouched.
 *
 * Insertion order survives, because a reader that names its buckets in header
 * order would otherwise hand a caller reading `rateLimits[0]` a different
 * bucket — a divergence nothing errors on. Later duplicates win, which is the
 * answer a case-insensitive lookup would give for a name a server spelled two
 * ways in one response.
 */
export function foldHeaderNames(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const folded: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    folded[foldHeaderName(name)] = value;
  }

  return folded;
}

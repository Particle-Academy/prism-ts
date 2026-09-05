import { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';
import { foldHeaderNames } from '../../http/header-names.js';

/**
 * Read Mistral's rate-limit headers.
 *
 * Mistral uses the `ratelimitbysize-*` family — one word, no separators, which
 * is neither OpenAI's `x-ratelimit-*` nor Anthropic's `anthropic-ratelimit-*`.
 *
 * **And NO BUCKET SEGMENT.** The service sends `ratelimitbysize-limit`, not
 * `ratelimitbysize-limit-tokens`. This reader used to expect the per-bucket
 * suffix for `requests` and `tokens`, so a real Mistral response produced an
 * empty array — indistinguishable from a provider that sent no quota headers at
 * all, and silent for every call. It was caught by `prism-parity`'s
 * `provider-rate-limits` corpus (`prl-0014`), not by this port's own tests,
 * which fed the parser the names the parser expected; register entry G-41.
 *
 * Mistral meters by SIZE, so the single bucket it reports is named `tokens` —
 * which is what the reference names it, what the reference's own `MistralTextTest`
 * asserts against, and what `prism-py` reads.
 *
 * The reset is a DURATION IN SECONDS, not a timestamp and not OpenAI's `1m30s`
 * string, so it is added to now rather than parsed as a date.
 */
export function parseRateLimits(headers: Readonly<Record<string, string>>): ProviderRateLimit[] {
  // Folded first: HTTP field names are case-insensitive (RFC 9110 §5.1) and
  // these are exact key lookups, so a title-casing gateway used to erase every
  // rate limit here without a word.
  const found = foldHeaderNames(headers);

  const limit = found['ratelimitbysize-limit'];
  const remaining = found['ratelimitbysize-remaining'];

  // Only when the provider actually reported one. The reference emits this
  // bucket unconditionally, so a response carrying no rate-limit headers comes
  // back from it saying limit 0, remaining 0, resets now — a provider that said
  // nothing, reported as exhausted. A caller cannot tell that apart from real
  // exhaustion, and both readings of it are wrong.
  if (limit === undefined || remaining === undefined) {
    return [];
  }

  return [
    new ProviderRateLimit(
      'tokens',
      toInteger(limit),
      toInteger(remaining),
      resetAt(found['ratelimitbysize-reset']),
    ),
  ];
}

function toInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Seconds from now, or null when the header is absent or not a number. */
function resetAt(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);

  return Number.isNaN(seconds) ? null : new Date(Date.now() + seconds * 1000);
}

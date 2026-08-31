import { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';

/**
 * Read Mistral's rate-limit headers.
 *
 * Mistral uses the `ratelimitbysize-*` family — one word, no separators, which
 * is neither OpenAI's `x-ratelimit-*` nor Anthropic's `anthropic-ratelimit-*`.
 * The reset is a DURATION IN SECONDS, not a timestamp and not OpenAI's `1m30s`
 * string, so it is added to now rather than parsed as a date.
 *
 * Two buckets, requests and tokens, matching what the service actually reports.
 * A bucket needs both a limit and a remaining or it is skipped: a limit with no
 * remaining tells a caller nothing, and defaulting remaining to zero would say
 * they are exhausted when they are not.
 */
const BUCKETS = ['requests', 'tokens'] as const;

export function parseRateLimits(headers: Readonly<Record<string, string>>): ProviderRateLimit[] {
  const rateLimits: ProviderRateLimit[] = [];

  for (const bucket of BUCKETS) {
    const limit = headers[`ratelimitbysize-limit-${bucket}`] ?? headers[`x-ratelimit-limit-${bucket}`];
    const remaining = headers[`ratelimitbysize-remaining-${bucket}`] ?? headers[`x-ratelimit-remaining-${bucket}`];

    if (limit === undefined || remaining === undefined) {
      continue;
    }

    const reset = headers[`ratelimitbysize-reset-${bucket}`] ?? headers[`x-ratelimit-reset-${bucket}`];

    rateLimits.push(new ProviderRateLimit(bucket, toInteger(limit), toInteger(remaining), resetAt(reset)));
  }

  return rateLimits;
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

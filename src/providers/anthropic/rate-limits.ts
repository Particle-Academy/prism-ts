import { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';
import { foldHeaderNames } from '../../http/header-names.js';

/**
 * Anthropic reports four buckets where OpenAI reports two, and the extra pair
 * matters: input and output tokens are limited SEPARATELY, so a caller that
 * only watched a combined figure would be surprised by which one ran out.
 */
const BUCKETS = ['requests', 'tokens', 'input-tokens', 'output-tokens'] as const;

/** Read Anthropic's `anthropic-ratelimit-*` headers into rate-limit value objects. */
export function parseRateLimits(headers: Readonly<Record<string, string>>): ProviderRateLimit[] {
  const rateLimits: ProviderRateLimit[] = [];

  // Folded first: HTTP field names are case-insensitive (RFC 9110 §5.1) and
  // these are exact key lookups, so an `Anthropic-RateLimit-…` from a
  // title-casing gateway used to match nothing and return an empty array —
  // which is also what a response with no quota headers looks like.
  const found = foldHeaderNames(headers);

  for (const bucket of BUCKETS) {
    const limit = found[`anthropic-ratelimit-${bucket}-limit`];
    const remaining = found[`anthropic-ratelimit-${bucket}-remaining`];

    // Both or neither. A bucket with a limit and no remaining tells a caller
    // nothing actionable, and reporting it as zero remaining would be a lie.
    if (limit === undefined || remaining === undefined) {
      continue;
    }

    rateLimits.push(
      new ProviderRateLimit(
        bucket,
        toInteger(limit),
        toInteger(remaining),
        parseResetTime(found[`anthropic-ratelimit-${bucket}-reset`]),
      ),
    );
  }

  return rateLimits;
}

function toInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Anthropic sends an RFC 3339 timestamp where OpenAI sends a duration.
 *
 * An unparseable value becomes null rather than the epoch: a reset time of
 * 1970 reads as "already reset" and would have a caller retry immediately into
 * the same limit.
 */
function parseResetTime(value: string | undefined): Date | null {
  if (value === undefined || value === '') {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

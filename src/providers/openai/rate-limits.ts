import { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';
import { foldHeaderNames } from '../../http/header-names.js';

const BUCKETS = ['requests', 'tokens'] as const;

/** Read OpenAI's `x-ratelimit-*` headers into rate-limit value objects. */
export function parseRateLimits(headers: Readonly<Record<string, string>>): ProviderRateLimit[] {
  const rateLimits: ProviderRateLimit[] = [];

  // Folded first: HTTP field names are case-insensitive (RFC 9110 §5.1) and
  // these are exact key lookups, so a title-casing gateway used to erase every
  // rate limit here without a word.
  const found = foldHeaderNames(headers);

  for (const bucket of BUCKETS) {
    const limit = found[`x-ratelimit-limit-${bucket}`];
    const remaining = found[`x-ratelimit-remaining-${bucket}`];

    if (limit === undefined || remaining === undefined) {
      continue;
    }

    rateLimits.push(
      new ProviderRateLimit(
        bucket,
        toInteger(limit),
        toInteger(remaining),
        parseResetTime(found[`x-ratelimit-reset-${bucket}`]),
      ),
    );
  }

  return rateLimits;
}

/**
 * OpenAI reports a reset as a DURATION from now (`6ms`, `30s`, `5m`, `1h`), not
 * as an instant. Anything else is reported as no known reset rather than as an
 * invalid date.
 */
function parseResetTime(resetTime: string | undefined, now: number = Date.now()): Date | null {
  if (resetTime === undefined || resetTime === '' || resetTime === '0') {
    return null;
  }

  const match = /^(\d+)(ms|s|m|h)$/.exec(resetTime);

  if (match === null) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? '0', 10);

  const milliseconds = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
  }[match[2] as 'ms' | 's' | 'm' | 'h'];

  return new Date(now + value * milliseconds);
}

function toInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? 0 : parsed;
}

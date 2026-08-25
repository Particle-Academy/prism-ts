import { ProviderRateLimit } from '../../value-objects/provider-rate-limit.js';

const BUCKETS = ['requests', 'tokens'] as const;

/** Read OpenAI's `x-ratelimit-*` headers into rate-limit value objects. */
export function parseRateLimits(headers: Readonly<Record<string, string>>): ProviderRateLimit[] {
  const rateLimits: ProviderRateLimit[] = [];

  for (const bucket of BUCKETS) {
    const limit = headers[`x-ratelimit-limit-${bucket}`];
    const remaining = headers[`x-ratelimit-remaining-${bucket}`];

    if (limit === undefined || remaining === undefined) {
      continue;
    }

    rateLimits.push(
      new ProviderRateLimit(
        bucket,
        toInteger(limit),
        toInteger(remaining),
        parseResetTime(headers[`x-ratelimit-reset-${bucket}`]),
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

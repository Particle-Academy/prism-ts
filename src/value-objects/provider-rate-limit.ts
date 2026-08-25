import type { JsonObject } from '../json.js';
import { readNullableNumber } from '../internal/filters.js';

export class ProviderRateLimit {
  constructor(
    readonly name: string,
    readonly limit: number | null = null,
    readonly remaining: number | null = null,
    readonly resetsAt: Date | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      name: this.name,
      limit: this.limit,
      remaining: this.remaining,
      resets_at: this.resetsAt === null ? null : toIso8601(this.resetsAt),
    };
  }

  static fromObject(object: JsonObject): ProviderRateLimit {
    const resetsAt = typeof object.resets_at === 'string' ? new Date(object.resets_at) : null;

    return new ProviderRateLimit(
      typeof object.name === 'string' ? object.name : '',
      readNullableNumber(object.limit),
      readNullableNumber(object.remaining),
      resetsAt !== null && !Number.isNaN(resetsAt.getTime()) ? resetsAt : null,
    );
  }
}

/**
 * ISO-8601 with an explicit UTC offset and no fractional seconds, matching what
 * the reference's date library emits (`2026-08-25T11:15:00+00:00`) rather than
 * JavaScript's `toISOString()` (`2026-08-25T11:15:00.000Z`).
 */
function toIso8601(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

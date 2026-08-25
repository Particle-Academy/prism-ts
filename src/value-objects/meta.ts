import type { JsonObject } from '../json.js';
import { isJsonObject } from '../json.js';
import { ProviderRateLimit } from './provider-rate-limit.js';

export class Meta {
  constructor(
    readonly id: string,
    readonly model: string,
    readonly rateLimits: readonly ProviderRateLimit[] = [],
    readonly serviceTier: string | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      id: this.id,
      model: this.model,
      rate_limits: this.rateLimits.map((rateLimit) => rateLimit.toObject()),
      service_tier: this.serviceTier,
    };
  }

  static fromObject(object: JsonObject): Meta {
    return new Meta(
      typeof object.id === 'string' ? object.id : '',
      typeof object.model === 'string' ? object.model : '',
      (Array.isArray(object.rate_limits) ? object.rate_limits : [])
        .filter(isJsonObject)
        .map((rateLimit) => ProviderRateLimit.fromObject(rateLimit)),
      typeof object.service_tier === 'string' ? object.service_tier : null,
    );
  }
}

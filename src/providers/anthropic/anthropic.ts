import { canonicalJson } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { HttpTransport } from '../../http/transport.js';
import { fetchTransport } from '../../http/transport.js';
import type { TextRequest } from '../../text/request.js';
import type { TextResponse } from '../../text/response.js';
import { Provider } from '../provider.js';
import { buildRequestBody } from './build-request-body.js';
import { parseTextResponse } from './parse-response.js';
import { parseRateLimits } from './rate-limits.js';

export interface AnthropicConfig {
  apiKey?: string;
  url?: string;
  /** The `anthropic-version` header. Pinned, not floating — see below. */
  apiVersion?: string;
  /** Sent as `anthropic-beta` when set. */
  betaFeatures?: string | null;
  transport?: HttpTransport;
}

const DEFAULT_URL = 'https://api.anthropic.com/v1';

/**
 * Pinned rather than tracking latest.
 *
 * The version header decides the response SHAPE. Floating it would let a
 * provider-side release change what this parser receives without a line of code
 * changing here — which is exactly the drift the conformance corpus exists to
 * catch, arriving through a door the corpus cannot see.
 */
const DEFAULT_API_VERSION = '2023-06-01';

/**
 * The Anthropic provider, Messages API.
 *
 * Configuration is explicit first and environment second, so a test can pin
 * every field and a deployment can set none of them — the same contract the
 * OpenAI provider offers.
 */
export class Anthropic extends Provider {
  override readonly providerName = 'Anthropic';

  readonly apiKey: string;

  readonly url: string;

  readonly apiVersion: string;

  readonly betaFeatures: string | null;

  readonly #transport: HttpTransport;

  constructor(config: AnthropicConfig = {}) {
    super();

    this.apiKey = config.apiKey ?? readEnv('ANTHROPIC_API_KEY') ?? '';
    this.url = config.url ?? readEnv('ANTHROPIC_URL') ?? DEFAULT_URL;
    this.apiVersion = config.apiVersion ?? readEnv('ANTHROPIC_API_VERSION') ?? DEFAULT_API_VERSION;
    this.betaFeatures = config.betaFeatures ?? readEnv('ANTHROPIC_BETA_FEATURES') ?? null;
    this.#transport = config.transport ?? fetchTransport;
  }

  override async text(request: TextRequest): Promise<TextResponse> {
    const response = await this.#transport({
      url: `${this.url.replace(/\/+$/, '')}/messages`,
      method: 'POST',
      headers: this.headers(),
      body: canonicalJson(buildRequestBody(request)),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      throw PrismError.providerResponseError(describeHttpFailure(this.providerName, response.status, response.body), {
        httpStatus: response.status,
        responseBody: response.rawBody,
      });
    }

    return parseTextResponse(request, response.body, { rateLimits: parseRateLimits(response.headers) });
  }

  /**
   * Anthropic authenticates with `x-api-key`, not a bearer token.
   *
   * Optional headers are OMITTED rather than sent empty when unconfigured.
   */
  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.apiVersion,
    };

    if (this.apiKey !== '') {
      headers['x-api-key'] = this.apiKey;
    }

    if (this.betaFeatures !== null && this.betaFeatures !== '') {
      headers['anthropic-beta'] = this.betaFeatures;
    }

    return headers;
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];

  return value === undefined || value === '' ? undefined : value;
}

function describeHttpFailure(provider: string, status: number, body: unknown): string {
  const error =
    typeof body === 'object' && body !== null && 'error' in body ? (body as { error: unknown }).error : undefined;

  const detail =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Unknown error';

  return `${provider} error [${status}]: ${detail}`;
}

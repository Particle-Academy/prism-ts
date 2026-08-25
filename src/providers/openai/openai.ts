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

export interface OpenAIConfig {
  apiKey?: string;
  url?: string;
  organization?: string | null;
  project?: string | null;
  /** Only `'responses'` is implemented; the chat-completions format is not ported. */
  apiFormat?: string;
  transport?: HttpTransport;
}

const DEFAULT_URL = 'https://api.openai.com/v1';

/**
 * The OpenAI provider, Responses API only.
 *
 * Configuration is explicit first and environment second, so a test can pin
 * every field and a deployment can set none of them.
 */
export class OpenAI extends Provider {
  override readonly providerName = 'OpenAI';

  readonly apiKey: string;

  readonly url: string;

  readonly organization: string | null;

  readonly project: string | null;

  readonly apiFormat: string;

  readonly #transport: HttpTransport;

  constructor(config: OpenAIConfig = {}) {
    super();

    this.apiKey = config.apiKey ?? readEnv('OPENAI_API_KEY') ?? '';
    this.url = config.url ?? readEnv('OPENAI_URL') ?? DEFAULT_URL;
    this.organization = config.organization ?? readEnv('OPENAI_ORGANIZATION') ?? null;
    this.project = config.project ?? readEnv('OPENAI_PROJECT') ?? null;
    this.apiFormat = config.apiFormat ?? readEnv('OPENAI_API_FORMAT') ?? 'responses';
    this.#transport = config.transport ?? fetchTransport;
  }

  override async text(request: TextRequest): Promise<TextResponse> {
    if (this.apiFormat !== 'responses') {
      throw PrismError.unsupportedProviderAction(`text in the ${this.apiFormat} api format`, this.providerName);
    }

    const response = await this.#transport({
      url: `${this.url.replace(/\/+$/, '')}/responses`,
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

  /** Optional headers are OMITTED rather than sent empty when unconfigured. */
  headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (this.organization !== null && this.organization !== '') {
      headers['OpenAI-Organization'] = this.organization;
    }

    if (this.project !== null && this.project !== '') {
      headers['OpenAI-Project'] = this.project;
    }

    if (this.apiKey !== '') {
      headers.Authorization = `Bearer ${this.apiKey}`;
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

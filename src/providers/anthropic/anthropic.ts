import { canonicalJson, isJsonObject } from '../../json.js';
import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { StructuredRequest } from '../../structured/request.js';
import type { StructuredResponse } from '../../structured/response.js';
import { structuredFromTextResponse } from '../../structured/from-text.js';
import type { HttpTransport } from '../../http/transport.js';
import { fetchTransport, fetchStreamTransport } from '../../http/transport.js';
import type { HttpStreamTransport } from '../../http/transport.js';
import type { StreamEvent } from '../../streaming/events.js';
import { sseData } from '../../streaming/sse.js';
import { ErrorEvent } from '../../streaming/events.js';
import { failureAwareSse } from '../../streaming/failure-usage.js';
import { AnthropicStreamMapper } from './stream-events.js';
import type { TextRequest } from '../../text/request.js';
import type { TextResponse } from '../../text/response.js';
import { Provider } from '../provider.js';
import { buildRequestBody, buildStructuredBody } from './build-request-body.js';
import { parseTextResponse } from './parse-response.js';
import { parseRateLimits } from './rate-limits.js';
import { withoutTrailingSlashes } from '../../internal/url.js';
import { anthropicBeta, configuredString, thinkingBudgetDefault } from '../../internal/provider-config.js';

export interface AnthropicConfig {
  apiKey?: string;
  url?: string | null;
  /** The `anthropic-version` header. Pinned, not floating — see below. */
  apiVersion?: string;
  /** Sent as `anthropic-beta` when set. */
  betaFeatures?: string | null;
  /** Configured fallback; an integer per-request budget takes precedence. */
  defaultThinkingBudget?: number | string | boolean | null;
  transport?: HttpTransport;
  streamTransport?: HttpStreamTransport;
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

  readonly defaultThinkingBudget: number;

  readonly #transport: HttpTransport;

  readonly #streamTransport: HttpStreamTransport;

  constructor(config: AnthropicConfig = {}) {
    super();

    this.apiKey = configuredString(config.apiKey, 'ANTHROPIC_API_KEY', '');
    this.url = configuredString(config.url, 'ANTHROPIC_URL', DEFAULT_URL, DEFAULT_URL);
    this.apiVersion = configuredString(config.apiVersion, 'ANTHROPIC_API_VERSION', DEFAULT_API_VERSION);
    this.betaFeatures = anthropicBeta(config.betaFeatures);
    this.defaultThinkingBudget = thinkingBudgetDefault(config.defaultThinkingBudget);
    this.#transport = config.transport ?? fetchTransport;
    this.#streamTransport = config.streamTransport ?? fetchStreamTransport;
  }

  override async text(request: TextRequest): Promise<TextResponse> {
    return this.#send(request, buildRequestBody(request, this.defaultThinkingBudget));
  }

  async #send(request: TextRequest, body: JsonObject): Promise<TextResponse> {
    const response = await this.#transport({
      url: `${withoutTrailingSlashes(this.url)}/messages`,
      method: 'POST',
      headers: this.headers(),
      body: canonicalJson(body),
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
   * The same generation, delivered as it arrives.
   *
   * The mapper is constructed PER CALL, not shared. It carries the message id,
   * the accumulated text and the stop reason for one stream; a shared instance
   * would let two concurrent generations read each other's blocks, which is the
   * kind of bug that only appears under load and looks like the model
   * hallucinating.
   */
  override async *stream(request: TextRequest): AsyncGenerator<StreamEvent> {
    const response = await this.#streamTransport({
      url: `${withoutTrailingSlashes(this.url)}/messages`,
      method: 'POST',
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      body: canonicalJson({ ...buildRequestBody(request, this.defaultThinkingBudget), stream: true }),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      throw PrismError.providerResponseError(
        describeHttpFailure(this.providerName, response.status, await collectJson(response.chunks)),
        { httpStatus: response.status },
      );
    }

    const mapper = new AnthropicStreamMapper();

    for await (const payload of failureAwareSse(sseData(response.chunks), () => mapper.failureUsage())) {
      if (payload instanceof ErrorEvent) { yield payload; continue; }
      const parsed = parsePayload(payload);
      if (parsed === null) { yield mapper.decodeFailure(); break; }
      const event = mapper.map(parsed);

      if (event !== null) {
        yield event;
      }
    }

    yield* mapper.finish();
  }

  /** Structured output through Anthropic's native output_config.format. */
  override async structured(request: StructuredRequest): Promise<StructuredResponse> {
    return structuredFromTextResponse(await this.#send(request, buildStructuredBody(request, this.defaultThinkingBudget)), {
      nativeOutputFormat: true,
    });
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

function describeHttpFailure(provider: string, status: number, body: unknown): string {
  const error =
    typeof body === 'object' && body !== null && 'error' in body ? (body as { error: unknown }).error : undefined;

  const detail =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Unknown error';

  return `${provider} error [${status}]: ${detail}`;
}

/** An SSE payload that is not JSON is skipped rather than fatal. */
function parsePayload(payload: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(payload);

    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

/** Drain a non-stream body so an HTTP failure can still report what it said. */
async function collectJson(chunks: AsyncIterable<string>): Promise<unknown> {
  let text = '';

  for await (const chunk of chunks) {
    text += chunk;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

import { canonicalJson, isJsonObject } from '../../json.js';
import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import { UserMessage } from '../../value-objects/messages/index.js';
import type { StructuredRequest } from '../../structured/request.js';
import type { StructuredResponse } from '../../structured/response.js';
import { structuredFromTextResponse } from '../../structured/from-text.js';
import type { HttpTransport } from '../../http/transport.js';
import { fetchTransport, fetchStreamTransport } from '../../http/transport.js';
import type { HttpStreamTransport } from '../../http/transport.js';
import type { StreamEvent } from '../../streaming/events.js';
import { sseData } from '../../streaming/sse.js';
import { AnthropicStreamMapper } from './stream-events.js';
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

  readonly #transport: HttpTransport;

  readonly #streamTransport: HttpStreamTransport;

  constructor(config: AnthropicConfig = {}) {
    super();

    this.apiKey = config.apiKey ?? readEnv('ANTHROPIC_API_KEY') ?? '';
    this.url = config.url ?? readEnv('ANTHROPIC_URL') ?? DEFAULT_URL;
    this.apiVersion = config.apiVersion ?? readEnv('ANTHROPIC_API_VERSION') ?? DEFAULT_API_VERSION;
    this.betaFeatures = config.betaFeatures ?? readEnv('ANTHROPIC_BETA_FEATURES') ?? null;
    this.#transport = config.transport ?? fetchTransport;
    this.#streamTransport = config.streamTransport ?? fetchStreamTransport;
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
      url: `${this.url.replace(/\/+$/, '')}/messages`,
      method: 'POST',
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      body: canonicalJson({ ...buildRequestBody(request), stream: true }),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      throw PrismError.providerResponseError(
        describeHttpFailure(this.providerName, response.status, await collectJson(response.chunks)),
        { httpStatus: response.status },
      );
    }

    const mapper = new AnthropicStreamMapper();

    for await (const payload of sseData(response.chunks)) {
      const event = mapper.map(parsePayload(payload));

      if (event !== null) {
        yield event;
      }
    }
  }

  /**
   * Structured output by ASKING, because Anthropic has no schema-enforcing mode.
   *
   * OpenAI can be told to enforce a schema; Anthropic cannot, so the reference
   * appends a message spelling out the schema and demanding JSON with nothing
   * around it. That is a request, not a guarantee — which is exactly why
   * `structured` is nullable and `text` survives beside it. A model that answers
   * in prose here has not malfunctioned; it has declined, and the caller gets to
   * see what it said.
   *
   * The instruction is appended as a USER message rather than a system prompt,
   * matching the reference: the caller's own system prompt keeps its meaning,
   * and the demand arrives as the most recent thing said.
   */
  override async structured(request: StructuredRequest): Promise<StructuredResponse> {
    request.addMessage(new UserMessage(schemaInstruction(request)));

    return structuredFromTextResponse(await this.text(request));
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

/**
 * The message that asks for JSON and nothing else.
 *
 * Wording tracks the reference deliberately, including the parenthetical about
 * backticks: models fence JSON by habit, and the phrasing is the only lever
 * there is. `extractStructured` still unfences as a second line of defence,
 * because a plea is not a guarantee.
 */
function schemaInstruction(request: StructuredRequest): string {
  return `Respond with ONLY JSON (i.e. not in backticks or a code block, with NO CONTENT outside the JSON) that matches the following schema: \n ${JSON.stringify(request.schema().toObject(), null, 2)}`;
}


/** An SSE payload that is not JSON is skipped rather than fatal. */
function parsePayload(payload: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(payload);

    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
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

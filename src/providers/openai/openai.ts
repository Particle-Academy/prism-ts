import { canonicalJson, isJsonObject } from '../../json.js';
import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { StructuredRequest } from '../../structured/request.js';
import type { StructuredResponse } from '../../structured/response.js';
import { structuredFromTextResponse } from '../../structured/from-text.js';
import { buildStructuredBody } from './build-structured-body.js';
import type { EmbeddingsRequest } from '../../embeddings/request.js';
import type { EmbeddingsResponse } from '../../embeddings/response.js';
import { buildEmbeddingsBody, parseEmbeddingsResponse } from './embeddings.js';
import type { ImagesRequest } from '../../images/request.js';
import type { ImagesResponse } from '../../images/response.js';
import { buildImagesBody, parseImagesResponse } from './images.js';
import type { ModerationRequest } from '../../moderation/request.js';
import type { ModerationResponse } from '../../moderation/response.js';
import { buildModerationBody, parseModerationResponse } from './moderation.js';
import type { SpeechToTextRequest, TextToSpeechRequest } from '../../audio/request.js';
import type { AudioResponse, AudioTextResponse } from '../../audio/response.js';
import {
  buildSpeechBody,
  buildTranscriptionForm,
  parseSpeechResponse,
  parseTranscriptionResponse,
} from './audio.js';
import type { HttpTransport } from '../../http/transport.js';
import { fetchTransport, fetchStreamTransport } from '../../http/transport.js';
import type { HttpBinaryTransport, HttpStreamTransport } from '../../http/transport.js';
import { fetchBinaryTransport } from '../../http/transport.js';
import type { StreamEvent } from '../../streaming/events.js';
import { sseData } from '../../streaming/sse.js';
import { mapStreamEvent } from './stream-events.js';
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
  streamTransport?: HttpStreamTransport;
  binaryTransport?: HttpBinaryTransport;
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

  readonly #streamTransport: HttpStreamTransport;

  readonly #binaryTransport: HttpBinaryTransport;

  constructor(config: OpenAIConfig = {}) {
    super();

    this.apiKey = config.apiKey ?? readEnv('OPENAI_API_KEY') ?? '';
    this.url = config.url ?? readEnv('OPENAI_URL') ?? DEFAULT_URL;
    this.organization = config.organization ?? readEnv('OPENAI_ORGANIZATION') ?? null;
    this.project = config.project ?? readEnv('OPENAI_PROJECT') ?? null;
    this.apiFormat = config.apiFormat ?? readEnv('OPENAI_API_FORMAT') ?? 'responses';
    this.#transport = config.transport ?? fetchTransport;
    this.#streamTransport = config.streamTransport ?? fetchStreamTransport;
    this.#binaryTransport = config.binaryTransport ?? fetchBinaryTransport;
  }

  override async text(request: TextRequest): Promise<TextResponse> {
    return this.#send('text', request, buildRequestBody(request));
  }

  override async structured(request: StructuredRequest): Promise<StructuredResponse> {
    // The response is parsed by the TEXT parser and then given its structured
    // reading, so finish reasons, token-limit failures, usage and rate limits
    // behave identically on both paths by construction.
    return structuredFromTextResponse(await this.#send('structured', request, buildStructuredBody(request)));
  }

  /**
   * The same generation, delivered as it arrives.
   *
   * `stream: true` is set here rather than in `buildRequestBody`, so the body a
   * streamed call sends is provably the non-streamed body plus one key — the
   * two cannot drift apart into different requests that happen to look alike.
   */
  override async *stream(request: TextRequest): AsyncGenerator<StreamEvent> {
    const response = await this.#streamTransport({
      url: `${this.url.replace(/\/+$/, '')}/responses`,
      method: 'POST',
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      body: canonicalJson({ ...buildRequestBody(request), stream: true }),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      // Read the body before failing: an error response is not an event stream,
      // and the message inside it is the only useful thing about this call.
      throw PrismError.providerResponseError(
        describeHttpFailure(this.providerName, response.status, await collectJson(response.chunks)),
        { httpStatus: response.status },
      );
    }

    for await (const payload of sseData(response.chunks)) {
      const event = mapStreamEvent(parsePayload(payload));

      if (event !== null) {
        yield event;
      }
    }
  }

  /**
   * Vectors for one or more inputs.
   *
   * A different endpoint from the rest of this provider, so it does not go
   * through `#send`: that helper posts to `/responses` and parses a text reply,
   * and bending it to also mean `/embeddings` would make both harder to read
   * than two short methods.
   */
  override async embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    const response = await this.#transport({
      url: `${this.url.replace(/\/+$/, '')}/embeddings`,
      method: 'POST',
      headers: this.headers(),
      body: canonicalJson(buildEmbeddingsBody(request)),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      throw PrismError.providerResponseError(describeHttpFailure(this.providerName, response.status, response.body), {
        httpStatus: response.status,
        responseBody: response.rawBody,
      });
    }

    return parseEmbeddingsResponse(response.body);
  }

  override async images(request: ImagesRequest): Promise<ImagesResponse> {
    const response = await this.#transport({
      url: `${this.url.replace(/\/+$/, '')}/images/generations`,
      method: 'POST',
      headers: this.headers(),
      body: canonicalJson(buildImagesBody(request)),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      throw PrismError.providerResponseError(describeHttpFailure(this.providerName, response.status, response.body), {
        httpStatus: response.status,
        responseBody: response.rawBody,
      });
    }

    return parseImagesResponse(response.body, request.model());
  }

  override async moderation(request: ModerationRequest): Promise<ModerationResponse> {
    const response = await this.#transport({
      url: `${this.url.replace(/\/+$/, '')}/moderations`,
      method: 'POST',
      headers: this.headers(),
      body: canonicalJson(buildModerationBody(request)),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      throw PrismError.providerResponseError(describeHttpFailure(this.providerName, response.status, response.body), {
        httpStatus: response.status,
        responseBody: response.rawBody,
      });
    }

    return parseModerationResponse(response.body, request.model());
  }

  override async textToSpeech(request: TextToSpeechRequest): Promise<AudioResponse> {
    const response = await this.#binaryTransport({
      url: `${this.url.replace(/\/+$/, '')}/audio/speech`,
      method: 'POST',
      headers: this.headers(),
      body: canonicalJson(buildSpeechBody(request)),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      // An error is JSON even on an endpoint that answers with audio, so the
      // bytes are decoded as text to get the message out.
      throw PrismError.providerResponseError(
        describeHttpFailure(this.providerName, response.status, decodeJson(response.bytes)),
        { httpStatus: response.status },
      );
    }

    return parseSpeechResponse(response.bytes, response.headers['content-type'] ?? null, request);
  }

  override async speechToText(request: SpeechToTextRequest): Promise<AudioTextResponse> {
    const response = await this.#binaryTransport({
      url: `${this.url.replace(/\/+$/, '')}/audio/transcriptions`,
      method: 'POST',
      headers: this.headers(),
      body: '',
      multipart: buildTranscriptionForm(request),
      clientOptions: request.clientOptions(),
    });

    const decoded = decodeJson(response.bytes);

    if (response.status >= 400) {
      throw PrismError.providerResponseError(describeHttpFailure(this.providerName, response.status, decoded), {
        httpStatus: response.status,
      });
    }

    return parseTranscriptionResponse(decoded);
  }

  async #send(action: string, request: TextRequest, body: JsonObject): Promise<TextResponse> {
    if (this.apiFormat !== 'responses') {
      throw PrismError.unsupportedProviderAction(`${action} in the ${this.apiFormat} api format`, this.providerName);
    }

    const response = await this.#transport({
      url: `${this.url.replace(/\/+$/, '')}/responses`,
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

/** An SSE payload that is not JSON is skipped rather than fatal — see mapStreamEvent. */
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


/** An audio endpoint answers with bytes; its ERRORS are still JSON. */
function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

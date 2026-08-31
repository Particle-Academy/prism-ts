import { canonicalJson, isJsonObject } from '../../json.js';
import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { EmbeddingsRequest } from '../../embeddings/request.js';
import type { EmbeddingsResponse } from '../../embeddings/response.js';
import type { FimRequest } from '../../fim/request.js';
import type { FimResponse } from '../../fim/response.js';
import type { SpeechToTextRequest } from '../../audio/request.js';
import type { AudioTextResponse } from '../../audio/response.js';
import type { StructuredRequest } from '../../structured/request.js';
import type { StructuredResponse } from '../../structured/response.js';
import { structuredFromTextResponse } from '../../structured/from-text.js';
import type { HttpBinaryTransport, HttpStreamTransport, HttpTransport } from '../../http/transport.js';
import { fetchBinaryTransport, fetchStreamTransport, fetchTransport } from '../../http/transport.js';
import type { StreamEvent } from '../../streaming/events.js';
import { sseData } from '../../streaming/sse.js';
import type { TextRequest } from '../../text/request.js';
import type { TextResponse } from '../../text/response.js';
import { Provider } from '../provider.js';
import { buildRequestBody, buildStructuredBody } from './build-request-body.js';
import { buildEmbeddingsBody, parseEmbeddingsResponse } from './embeddings.js';
import { buildFimBody, parseFimResponse } from './fim.js';
import { parseTextResponse } from './parse-response.js';
import { parseRateLimits } from './rate-limits.js';
import { MistralStreamMapper } from './stream-events.js';
import { buildTranscriptionForm, parseTranscriptionResponse } from '../openai/audio.js';

export interface MistralConfig {
  apiKey?: string;
  url?: string;
  transport?: HttpTransport;
  streamTransport?: HttpStreamTransport;
  binaryTransport?: HttpBinaryTransport;
}

const DEFAULT_URL = 'https://api.mistral.ai/v1';

/**
 * The Mistral provider.
 *
 * The third provider in this port, and the first that is neither OpenAI's
 * Responses API nor Anthropic's Messages API: Mistral speaks the OpenAI
 * CHAT-COMPLETIONS shape. That is close enough to be worth stating plainly,
 * because the temptation to share the OpenAI mapper is real and wrong — the two
 * disagree on the request envelope (`messages` vs `input`), on where the finish
 * reason lives (the choice vs the root), and on the tool-call argument encoding
 * (a JSON string vs an object). Every one of those fails quietly.
 *
 * It exists because `fim` does. Fill-in-the-middle is a Mistral-only capability
 * in the reference, so the twelfth capability could not land in this port
 * without it — but a provider that served only `fim` would be a provider nobody
 * could use for anything else, so the surface the reference gives Mistral is
 * ported whole: text, structured, stream, embeddings, fim, speechToText.
 */
export class Mistral extends Provider {
  override readonly providerName = 'Mistral';

  readonly apiKey: string;

  readonly url: string;

  readonly #transport: HttpTransport;

  readonly #streamTransport: HttpStreamTransport;

  readonly #binaryTransport: HttpBinaryTransport;

  constructor(config: MistralConfig = {}) {
    super();

    this.apiKey = config.apiKey ?? readEnv('MISTRAL_API_KEY') ?? '';
    this.url = (config.url ?? readEnv('MISTRAL_URL') ?? DEFAULT_URL).replace(/\/+$/, '');
    this.#transport = config.transport ?? fetchTransport;
    this.#streamTransport = config.streamTransport ?? fetchStreamTransport;
    this.#binaryTransport = config.binaryTransport ?? fetchBinaryTransport;
  }

  override async text(request: TextRequest): Promise<TextResponse> {
    const response = await this.#post('chat/completions', canonicalJson(buildRequestBody(request)), request.clientOptions());

    return parseTextResponse(request, response.body, { rateLimits: parseRateLimits(response.headers) });
  }

  /**
   * Structured output through Mistral's OWN strict schema mode.
   *
   * So this is enforced, not requested — the same guarantee the OpenAI path
   * gives and stronger than the Anthropic one, which can only ask. G-08 records
   * that `structured` means different things per provider; Mistral lands on the
   * strong side of it.
   */
  override async structured(request: StructuredRequest): Promise<StructuredResponse> {
    const response = await this.#post(
      'chat/completions',
      canonicalJson(buildStructuredBody(request)),
      request.clientOptions(),
    );

    return structuredFromTextResponse(
      parseTextResponse(request, response.body, { rateLimits: parseRateLimits(response.headers) }),
    );
  }

  /**
   * Fill in the middle: a prefix, an optional suffix, and the gap between them.
   *
   * A DIFFERENT ENDPOINT from chat, not a mode of it — `fim/completions` takes
   * a prompt and a suffix and has no messages at all. That is why the capability
   * has its own builder rather than a flag on the text one.
   */
  override async fim(request: FimRequest): Promise<FimResponse> {
    const response = await this.#post('fim/completions', canonicalJson(buildFimBody(request)), request.clientOptions());

    return parseFimResponse(response.body, request, parseRateLimits(response.headers));
  }

  override async embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    const response = await this.#post('embeddings', canonicalJson(buildEmbeddingsBody(request)), request.clientOptions());

    return parseEmbeddingsResponse(response.body);
  }

  /**
   * Transcription, sharing the OpenAI multipart form.
   *
   * SHARED DELIBERATELY, unlike the chat mapping. Mistral's
   * `audio/transcriptions` is the Whisper endpoint shape field for field — a
   * `file` part plus `model`, `language`, `prompt`, `response_format` and
   * `temperature` — so a second copy would be a copy, and the two would drift
   * on whichever one someone edited. The chat endpoints are not shared for the
   * opposite reason: they only look alike.
   */
  override async speechToText(request: SpeechToTextRequest): Promise<AudioTextResponse> {
    const response = await this.#binaryTransport({
      url: `${this.url}/audio/transcriptions`,
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

  /**
   * The same generation, delivered as it arrives.
   *
   * The mapper is constructed PER CALL. It carries the message id, the
   * accumulated text and half-assembled tool-call arguments for one stream; a
   * shared instance would let two concurrent generations read each other's
   * fragments.
   *
   * A chunk can produce SEVERAL events — the first carries both the stream
   * start and the first token — so the mapper returns a list and this yields
   * every member. Taking only the first would drop tokens silently.
   */
  override async *stream(request: TextRequest): AsyncGenerator<StreamEvent> {
    const response = await this.#streamTransport({
      url: `${this.url}/chat/completions`,
      method: 'POST',
      headers: { ...this.headers(), Accept: 'text/event-stream' },
      body: canonicalJson({ ...buildRequestBody(request), stream: true }),
      clientOptions: request.clientOptions(),
    });

    if (response.status >= 400) {
      let raw = '';

      for await (const chunk of response.chunks) {
        raw += chunk;
      }

      throw PrismError.providerResponseError(
        describeHttpFailure(this.providerName, response.status, parsePayload(raw)),
        { httpStatus: response.status },
      );
    }

    const mapper = new MistralStreamMapper();

    for await (const payload of sseData(response.chunks)) {
      // Mistral closes with a literal `[DONE]`, which is not JSON. Parsing it
      // yields null and the mapper would read an empty payload as a chunk.
      if (payload === '[DONE]') {
        return;
      }

      for (const event of mapper.map(parsePayload(payload))) {
        yield event;
      }
    }
  }

  /** A bearer token, like OpenAI and unlike Anthropic's `x-api-key`. */
  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.apiKey !== '') {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  async #post(
    path: string,
    body: string,
    clientOptions: Readonly<Record<string, unknown>>,
  ): Promise<{ body: unknown; headers: Readonly<Record<string, string>> }> {
    const response = await this.#transport({
      url: `${this.url}/${path}`,
      method: 'POST',
      headers: this.headers(),
      body,
      clientOptions,
    });

    if (response.status >= 400) {
      throw PrismError.providerResponseError(describeHttpFailure(this.providerName, response.status, response.body), {
        httpStatus: response.status,
        responseBody: response.rawBody,
      });
    }

    return { body: response.body, headers: response.headers };
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];

  return value === undefined || value === '' ? undefined : value;
}

/**
 * A message out of either error shape Mistral uses.
 *
 * A nested `error.message` on most failures, and a BARE `message` on validation
 * errors — the second is what a malformed request actually gets, so reading
 * only the first reports "Unknown error" for the most common mistake.
 */
function describeHttpFailure(provider: string, status: number, body: unknown): string {
  if (!isJsonObject(body)) {
    return `${provider} error [${status}]: Unknown error`;
  }

  const error = isJsonObject(body.error) ? body.error : null;
  const detail =
    (error !== null && typeof error.message === 'string' ? error.message : null) ??
    (typeof body.message === 'string' ? body.message : null) ??
    'Unknown error';

  return `${provider} error [${status}]: ${detail}`;
}

function parsePayload(payload: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(payload);

    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

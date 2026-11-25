/**
 * The seam between a provider and the network.
 *
 * Providers never call `fetch` directly — they call a `HttpTransport`. That is
 * what lets a test drive a provider end to end without a network, and what lets
 * an application wrap every call in its own retry, proxy or instrumentation.
 */

import { PrismUrlRefused } from '../errors.js';
import { foldHeaderName } from './header-names.js';
import { abortable, DEFAULT_STREAM_IDLE_TIMEOUT, RequestDeadline, timeoutSeconds, withRequestDeadline } from './deadline.js';

export interface HttpRequest {
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  /** Already-serialized canonical JSON. */
  body: string;
  /** Whatever `withClientOptions()` was given, passed through untouched. */
  clientOptions: Readonly<Record<string, unknown>>;
}

export interface HttpResponse {
  status: number;
  /** Header names lowercased. */
  headers: Readonly<Record<string, string>>;
  /** The parsed JSON body, or `null` when the body was empty or not JSON. */
  body: unknown;
  /** The body as text, kept for error reporting. */
  rawBody: string;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/** The default transport: `fetch`, available as a global from Node 18. */
export const fetchTransport: HttpTransport = async (request: HttpRequest): Promise<HttpResponse> => {
  return withRequestDeadline(request.clientOptions, async (signal) => {
  const response = await fetchSameOrigin(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
    ...request.clientOptions,
  }, signal);

  const rawBody = await abortable(response.text(), signal);
  const headers: Record<string, string> = {};

  response.headers.forEach((value, name) => {
    headers[foldHeaderName(name)] = value;
  });

  return {
    status: response.status,
    headers,
    body: parseJson(rawBody),
    rawBody,
  };
  });
};

/**
 * Redirect hops a provider call may take, all on the origin it started on.
 * Five, as in the reference: its HTTP client follows five and refuses the sixth.
 */
const MAX_PROVIDER_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Headers that describe a body, dropped with it when a redirect turns the request into a GET. */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location'];

/**
 * `fetch` for a provider call: redirects are followed only while the scheme,
 * host and port stay the same as the first request's.
 *
 * Provider requests carry credentials in headers, and `fetch` keeps most
 * headers when it follows a redirect to another host. So redirects are handled
 * here, with `redirect: 'manual'` set after the caller's client options so they
 * cannot turn it back on. A redirect to any other origin is refused before a
 * second request is made. Same-origin hops keep the method, body and headers,
 * except that a 303, or a 301/302 answering a POST, becomes a GET without a body,
 * as `fetch` itself would do.
 *
 * A url that `fetch` cannot send at all, one that does not parse or that
 * carries userinfo, is refused here with a code. `fetch` would throw a bare
 * TypeError whose message repeats the url, userinfo included.
 */
async function fetchSameOrigin(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  assertSendable(url);
  const origin = originOf(url);
  let current = url;
  let method = (init.method ?? 'GET').toUpperCase();
  let headers: RequestInit['headers'] = init.headers;
  let body: RequestInit['body'] = init.body;

  for (let hop = 0; ; hop++) {
    signal.throwIfAborted();
    const hopInit: RequestInit = { ...init, method, redirect: 'manual', signal };
    delete hopInit.headers;
    delete hopInit.body;

    if (headers !== undefined) {
      hopInit.headers = headers;
    }

    // A GET or HEAD cannot carry a body; `fetch` refuses one, even when empty.
    if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
      hopInit.body = body;
    }

    const response = await abortable(fetch(current, hopInit), signal);

    const location = response.headers.get('location');

    if (!REDIRECT_STATUSES.has(response.status) || location === null || location === '') {
      return response;
    }

    // The redirect's own body is never read; release the connection.
    await abortable(response.body?.cancel() ?? Promise.resolve(), signal);

    let next: URL;

    try {
      next = new URL(location, current);
    } catch {
      throw new PrismUrlRefused('redirect_refused', `The provider answered ${response.status} with a Location that is not a valid URL; it was not followed.`);
    }

    if (origin === null || originOf(next.href) !== origin) {
      throw new PrismUrlRefused('redirect_refused', `The provider answered ${response.status} with a redirect to a different origin; it was not followed.`);
    }

    if (next.username !== '' || next.password !== '') {
      throw new PrismUrlRefused('redirect_refused', `The provider answered ${response.status} with a Location that carries credentials; it was not followed.`);
    }

    if (hop >= MAX_PROVIDER_REDIRECTS) {
      throw new PrismUrlRefused('too_many_redirects', `The provider redirected more than ${MAX_PROVIDER_REDIRECTS} times.`);
    }

    if ((response.status === 303 && method !== 'GET' && method !== 'HEAD')
      || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      const remaining = new Headers(headers);

      for (const name of BODY_HEADERS) {
        remaining.delete(name);
      }

      headers = remaining;
    }

    current = next.href;
  }
}

/**
 * Refuses a url `fetch` cannot send, without repeating it: `scheme_not_allowed`,
 * the code the reference's per-call guard gives a url it cannot use.
 */
function assertSendable(url: string): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new PrismUrlRefused('scheme_not_allowed', 'The provider url is not an absolute url, so the request was not sent.');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new PrismUrlRefused('scheme_not_allowed', 'The provider url carries userinfo (a user name or password before the host), which cannot be sent; pass credentials in the provider config instead.');
  }
}

/** `scheme://host:port` with the default port made explicit, or null for anything but http(s). */
function originOf(url: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? '443' : '80') : parsed.port;

  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}`;
}

function parseJson(body: string): unknown {
  if (body === '') {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * A response whose body arrives in pieces.
 *
 * Separate from `HttpResponse` rather than a mode of it, because the two have
 * genuinely different contracts: one has a body you can read twice, the other
 * has a body you can read once. Modelling them as one type would let a caller
 * hold a `body` that is sometimes a string and sometimes already consumed.
 *
 * The chunks are whatever the network handed over — NOT lines and NOT events. A
 * transport that promised lines would have to buffer, and buffering is where
 * streaming bugs live; the parser owns reassembly instead, where it can be
 * tested with payloads split at deliberately awkward places.
 */
export interface HttpStreamResponse {
  status: number;
  /** Header names lowercased. */
  headers: Readonly<Record<string, string>>;
  chunks: AsyncIterable<string>;
}

export type HttpStreamTransport = (request: HttpRequest) => Promise<HttpStreamResponse>;

/** The default streaming transport: `fetch`, reading the body as it arrives. */
export const fetchStreamTransport: HttpStreamTransport = async (
  request: HttpRequest,
): Promise<HttpStreamResponse> => {
  const idleTimeout = timeoutSeconds(request.clientOptions.read_timeout, DEFAULT_STREAM_IDLE_TIMEOUT);
  const deadline = new RequestDeadline(timeoutSeconds(request.clientOptions.timeout), request.clientOptions.signal as AbortSignal | null | undefined);
  try {
  deadline.signal.throwIfAborted();
  const response = await fetchSameOrigin(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
    ...request.clientOptions,
  }, deadline.signal);
  deadline.clear();

  const headers: Record<string, string> = {};

  response.headers.forEach((value, name) => {
    headers[foldHeaderName(name)] = value;
  });

  return { status: response.status, headers, chunks: readChunks(response, deadline, idleTimeout) };
  } catch (error) {
    deadline.clear();
    throw error;
  }
};

function readChunks(response: Response, deadline: RequestDeadline, idleTimeout: number): AsyncGenerator<string> {
  const state = { started: false };
  const iterator = readChunksGenerator(response, deadline, state, idleTimeout);
  const finish = iterator.return.bind(iterator);
  const fail = iterator.throw.bind(iterator);
  const closeUnstarted = async (): Promise<void> => {
    if (!state.started) {
      deadline.clear();
      void response.body?.cancel().catch(() => undefined);
    }
  };
  iterator.return = async (value) => { await closeUnstarted(); return finish(value); };
  iterator.throw = async (error) => { await closeUnstarted(); return fail(error); };
  return iterator;
}

async function* readChunksGenerator(response: Response, deadline: RequestDeadline, state: { started: boolean }, idleTimeout: number): AsyncGenerator<string> {
  state.started = true;
  if (response.body === null) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let completed = false;

  try {
    for (;;) {
      deadline.arm(idleTimeout);
      const { done, value } = await abortable(reader.read(), deadline.signal);
      deadline.clear();

      if (done) {
        completed = true;
        // Flush whatever the decoder is holding: a multi-byte character split
        // across two network chunks is only complete once the stream ends.
        const tail = decoder.decode();

        if (tail !== '') {
          yield tail;
        }

        return;
      }

      yield decoder.decode(value, { stream: true });
    }
  } finally {
    deadline.clear();
    if (!completed) void reader.cancel().catch(() => undefined);
    // Releases the lock even when the consumer abandons the generator, which
    // is the ordinary case for a browser that navigated away mid-answer.
    reader.releaseLock();
  }
}

/**
 * A file being uploaded as part of a multipart request.
 *
 * `bytes` rather than a path: the transport should not be reading the disk. By
 * the time a request reaches it, whatever named the file has already decided
 * whether it exists — which keeps a "file not found" attributable to the caller
 * that named it rather than surfacing from inside the network layer.
 */
export interface MultipartFile {
  field: string;
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
}

/**
 * A request whose body is a multipart form rather than JSON.
 *
 * Separate from the JSON `body` rather than a union on it, so a provider cannot
 * accidentally send both and a transport cannot silently prefer one. Exactly one
 * of `body` and `multipart` is meaningful for any request.
 */
export interface MultipartBody {
  fields: Readonly<Record<string, string>>;
  files: readonly MultipartFile[];
}

export interface HttpBinaryResponse {
  status: number;
  /** Header names lowercased. */
  headers: Readonly<Record<string, string>>;
  bytes: Uint8Array;
}

export type HttpBinaryTransport = (
  request: HttpRequest & { multipart?: MultipartBody },
) => Promise<HttpBinaryResponse>;

/**
 * The default binary transport.
 *
 * Reads the whole body into memory, which is right for the payloads this serves
 * — a spoken sentence is measured in kilobytes — and would be wrong for a large
 * file. When something needs to stream audio out, that is a different transport
 * rather than a flag on this one.
 */
export const fetchBinaryTransport: HttpBinaryTransport = async (request): Promise<HttpBinaryResponse> => {
  const headers = { ...request.headers };
  let body: string | FormData = request.body;

  if (request.multipart !== undefined) {
    const form = new FormData();

    for (const [name, value] of Object.entries(request.multipart.fields)) {
      form.append(name, value);
    }

    for (const file of request.multipart.files) {
      form.append(
        file.field,
        // Copied into a fresh ArrayBuffer. A Uint8Array can be a VIEW over a
        // larger buffer — one slice of a pooled Node Buffer, say — and Blob
        // takes the whole backing store, so handing the view straight over can
        // upload bytes that were never part of this file.
        new Blob([new Uint8Array(file.bytes).buffer], {
          type: file.contentType ?? 'application/octet-stream',
        }),
        file.filename,
      );
    }

    body = form;

    // DELETED, not overwritten. `fetch` sets the multipart boundary itself, and
    // a Content-Type left behind from the JSON path arrives without one — which
    // a server reads as a malformed body rather than as a missing boundary, so
    // the error names the wrong thing.
    delete headers['Content-Type'];
    delete headers['content-type'];
  }

  return withRequestDeadline(request.clientOptions, async (signal) => {
  const response = await fetchSameOrigin(request.url, {
    method: request.method,
    headers,
    body,
    ...request.clientOptions,
  }, signal);

  const responseHeaders: Record<string, string> = {};

  response.headers.forEach((value, name) => {
    responseHeaders[foldHeaderName(name)] = value;
  });

  return {
    status: response.status,
    headers: responseHeaders,
    bytes: new Uint8Array(await abortable(response.arrayBuffer(), signal)),
  };
  });
};

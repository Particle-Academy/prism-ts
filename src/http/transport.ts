/**
 * The seam between a provider and the network.
 *
 * Providers never call `fetch` directly — they call a `HttpTransport`. That is
 * what lets a test drive a provider end to end without a network, and what lets
 * an application wrap every call in its own retry, proxy or instrumentation.
 */

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
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
    ...request.clientOptions,
  });

  const rawBody = await response.text();
  const headers: Record<string, string> = {};

  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  return {
    status: response.status,
    headers,
    body: parseJson(rawBody),
    rawBody,
  };
};

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
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
    ...request.clientOptions,
  });

  const headers: Record<string, string> = {};

  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  return { status: response.status, headers, chunks: readChunks(response) };
};

async function* readChunks(response: Response): AsyncGenerator<string> {
  if (response.body === null) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
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
    // Releases the lock even when the consumer abandons the generator, which
    // is the ordinary case for a browser that navigated away mid-answer.
    reader.releaseLock();
  }
}

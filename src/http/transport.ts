/**
 * The seam between a provider and the network.
 *
 * Providers never call `fetch` directly — they call a `HttpTransport`. That is
 * what lets a test drive a provider end to end without a network, and what lets
 * an application wrap every call in its own retry, proxy or instrumentation.
 */

import { foldHeaderName } from './header-names.js';

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
    headers[foldHeaderName(name)] = value;
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
    headers[foldHeaderName(name)] = value;
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

  const response = await fetch(request.url, {
    method: request.method,
    headers,
    body,
    ...request.clientOptions,
  });

  const responseHeaders: Record<string, string> = {};

  response.headers.forEach((value, name) => {
    responseHeaders[foldHeaderName(name)] = value;
  });

  return {
    status: response.status,
    headers: responseHeaders,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
};

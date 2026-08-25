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

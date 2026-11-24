import { vi } from 'vitest';

/**
 * A fetch that never reaches the network.
 *
 * Installed before the first request: anything not answered by a queued reply
 * throws, so a test that sends more requests than it expects fails instead of
 * leaving the machine.
 */

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type Reply = Response | Error | (() => Response);

export interface FakeFetch {
  sent: SentRequest[];
  reply(...replies: Reply[]): void;
}

export function installFakeFetch(): FakeFetch {
  const sent: SentRequest[] = [];
  const queue: Reply[] = [];

  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of new Headers(init?.headers).entries()) headers[key] = value;
    sent.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });

    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error('Unexpected request: the network is blocked in this test.'));
    if (next instanceof Error) return Promise.reject(next);

    return Promise.resolve(typeof next === 'function' ? next() : next);
  }));

  return { sent, reply: (...replies) => { queue.push(...replies); } };
}

export function jsonReply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function sseReply(payloads: readonly (string | object)[]): Response {
  const text = payloads
    .map((payload) => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
    .join('');

  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Every header value and the body of every request, for "never contains" assertions. */
export function wire(sent: readonly SentRequest[]): string {
  return sent.map((request) => `${request.url}\n${JSON.stringify(request.headers)}\n${request.body}`).join('\n');
}

export const OPENAI_ENVIRONMENT = ['OPENAI_API_KEY', 'OPENAI_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT', 'OPENAI_API_FORMAT'];

export function clearOpenAIEnvironment(): void {
  for (const name of OPENAI_ENVIRONMENT) vi.stubEnv(name, undefined);
}

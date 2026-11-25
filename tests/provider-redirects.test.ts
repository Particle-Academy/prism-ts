import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureProviders, Prism, PrismError, PrismUrlRefused } from '../src/index.js';
import { fetchBinaryTransport, fetchStreamTransport, fetchTransport } from '../src/http/transport.js';
import type { HttpRequest } from '../src/http/transport.js';

/*
 * Provider calls follow a redirect only when the scheme, host and port stay the
 * same. Every case runs against real loopback servers: the provider endpoint
 * answers with a redirect, and a second server on another host (127.0.0.2) or
 * another port records whatever reaches it. Non-loopback connections are
 * refused before they are made, and every credential here is a fixture.
 */

const KEY = 'sk-test-redirect-fixture-key';
const ORGANIZATION = 'org-test-redirect-fixture';
const PROJECT = 'proj-test-redirect-fixture';
const CREDENTIALS = [KEY, ORGANIZATION, PROJECT];

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface Planned {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

interface Endpoint {
  server: Server;
  base: string;
  port: number;
  received: Received[];
  plan: (request: Received) => Planned;
}

async function listen(host: string): Promise<Endpoint> {
  const endpoint: Endpoint = {
    server: createServer(),
    base: '',
    port: 0,
    received: [],
    plan: () => ({ status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":{"message":"unexpected"}}' }),
  };
  endpoint.server.on('request', (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const received: Received = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      endpoint.received.push(received);
      const planned = endpoint.plan(received);
      response.writeHead(planned.status, planned.headers ?? {});
      response.end(planned.body ?? '');
    });
  });
  await new Promise<void>((resolve) => endpoint.server.listen(0, host, resolve));
  endpoint.port = (endpoint.server.address() as AddressInfo).port;
  endpoint.base = `http://${host}:${endpoint.port}`;
  return endpoint;
}

function isLoopback(url: string): boolean {
  const hostname = new URL(url).hostname;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

let origin: Endpoint;
let otherHost: Endpoint;
let otherPort: Endpoint;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  origin = await listen('127.0.0.1');
  otherHost = await listen('127.0.0.2');
  otherPort = await listen('127.0.0.1');
});

afterAll(async () => {
  for (const endpoint of [origin, otherHost, otherPort]) {
    endpoint.server.closeAllConnections();
    await new Promise<void>((resolve) => endpoint.server.close(() => resolve()));
  }
});

beforeEach(() => {
  for (const endpoint of [origin, otherHost, otherPort]) {
    endpoint.received.length = 0;
    endpoint.plan = () => ({ status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":{"message":"unexpected"}}' });
  }
  for (const name of ['OPENAI_API_KEY', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT', 'OPENAI_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_URL', 'MISTRAL_API_KEY', 'MISTRAL_URL']) {
    vi.stubEnv(name, undefined);
  }
  // The loopback servers are reached through a per-call url, which is refused
  // for a loopback address unless the provider's configuration opts out.
  for (const name of ['OPENAI_ALLOW_PRIVATE_PER_CALL_URL', 'ANTHROPIC_ALLOW_PRIVATE_PER_CALL_URL', 'MISTRAL_ALLOW_PRIVATE_PER_CALL_URL']) {
    vi.stubEnv(name, 'true');
  }
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isLoopback(url)) {
      throw new Error(`Test refused a non-loopback connection to ${new URL(url).host}.`);
    }
    return realFetch(input, init);
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const STATUSES = [301, 302, 303, 307, 308] as const;

type TargetName = 'another host' | 'another port';

function target(name: TargetName): Endpoint {
  return name === 'another host' ? otherHost : otherPort;
}

function redirectEverythingTo(status: number, destination: Endpoint): void {
  origin.plan = (request) => ({ status, headers: { location: `${destination.base}${request.url}` } });
  destination.plan = () => ({ status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":{"message":"second server"}}' });
}

async function outcome(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
    return null;
  } catch (error) {
    return error;
  }
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const event of stream) {
    void event;
  }
}

function expectRefused(error: unknown, destination: Endpoint): void {
  expect(destination.received).toEqual([]);
  expect(error).toBeInstanceOf(PrismUrlRefused);
  expect((error as PrismUrlRefused).code).toBe('redirect_refused');
  const text = `${String((error as Error).message)} ${String((error as Error).stack)}`;
  for (const credential of CREDENTIALS) {
    expect(text).not.toContain(credential);
  }
  // The endpoint that answered with the redirect saw exactly one request.
  expect(origin.received).toHaveLength(1);
}

let counter = 0;
function compatibleName(): string {
  counter += 1;
  return `redirect-compat-${Date.now().toString(36)}-${counter}`;
}

interface Route {
  label: string;
  text: () => Promise<unknown>;
  stream: () => Promise<unknown>;
}

function routes(): Route[] {
  const openai = { apiKey: KEY, organization: ORGANIZATION, project: PROJECT, url: `${origin.base}/v1` };
  const compatible = (): string => {
    const name = compatibleName();
    configureProviders({ [name]: { driver: 'openai-compatible', url: `${origin.base}/v1`, apiKey: KEY, organization: ORGANIZATION, project: PROJECT } });
    return name;
  };

  return [
    {
      label: 'anthropic',
      text: () => Prism.text().using('anthropic', 'claude-sonnet-5-5', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asText(),
      stream: () => drain(Prism.text().using('anthropic', 'claude-sonnet-5-5', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asStream()),
    },
    {
      label: 'mistral',
      text: () => Prism.text().using('mistral', 'mistral-small-latest', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asText(),
      stream: () => drain(Prism.text().using('mistral', 'mistral-small-latest', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asStream()),
    },
    {
      label: 'openai',
      text: () => Prism.text().using('openai', 'gpt-4o', openai).withPrompt('Hi').asText(),
      stream: () => drain(Prism.text().using('openai', 'gpt-4o', openai).withPrompt('Hi').asStream()),
    },
    {
      label: 'openai with apiFormat chat_completions',
      text: () => Prism.text().using('openai', 'gpt-4o', { ...openai, apiFormat: 'chat_completions' }).withPrompt('Hi').asText(),
      stream: () => drain(Prism.text().using('openai', 'gpt-4o', { ...openai, apiFormat: 'chat_completions' }).withPrompt('Hi').asStream()),
    },
    {
      label: 'a named openai-compatible provider',
      text: () => Prism.text().using(compatible(), 'local-model').withPrompt('Hi').asText(),
      stream: () => drain(Prism.text().using(compatible(), 'local-model').withPrompt('Hi').asStream()),
    },
  ];
}

describe.each(['another host', 'another port'] as const)('a provider redirected to %s', (targetName) => {
  describe.each(STATUSES)('with status %i', (status) => {
    it.each(['anthropic', 'mistral', 'openai', 'openai with apiFormat chat_completions', 'a named openai-compatible provider'])('does not follow it for text on %s', async (label) => {
      const route = routes().find((candidate) => candidate.label === label)!;
      redirectEverythingTo(status, target(targetName));
      expectRefused(await outcome(route.text), target(targetName));
    });

    it.each(['anthropic', 'mistral', 'openai', 'openai with apiFormat chat_completions', 'a named openai-compatible provider'])('does not follow it for stream on %s', async (label) => {
      const route = routes().find((candidate) => candidate.label === label)!;
      redirectEverythingTo(status, target(targetName));
      expectRefused(await outcome(route.stream), target(targetName));
    });

    it.each(['openai', 'mistral'])('does not follow it for embeddings on %s', async (provider) => {
      redirectEverythingTo(status, target(targetName));
      const config = { apiKey: KEY, url: `${origin.base}/v1`, ...(provider === 'openai' ? { organization: ORGANIZATION, project: PROJECT } : {}) };
      expectRefused(
        await outcome(() => Prism.embeddings().using(provider, 'embed-model', config).fromInput('hello').asEmbeddings()),
        target(targetName),
      );
    });

    it.each([
      ['batch retrieve', () => Prism.batch().using('openai', { apiKey: KEY, organization: ORGANIZATION, project: PROJECT, url: `${origin.base}/v1` }).retrieve('batch_1')],
      ['file metadata', () => Prism.files().using('openai', { apiKey: KEY, organization: ORGANIZATION, project: PROJECT, url: `${origin.base}/v1` }).getMetadata('file_1')],
      ['file download', () => Prism.files().using('openai', { apiKey: KEY, organization: ORGANIZATION, project: PROJECT, url: `${origin.base}/v1` }).download('file_1')],
    ] as const)('does not follow it for an openai %s GET', async (_label, work) => {
      redirectEverythingTo(status, target(targetName));
      expectRefused(await outcome(work), target(targetName));
    });
  });
});

describe('a provider redirect that stays on the same origin', () => {
  const OK_BODY = JSON.stringify({
    id: 'resp_1',
    model: 'gpt-4o',
    status: 'completed',
    output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'Hello.' }] }],
    usage: { input_tokens: 10, output_tokens: 2 },
  });
  const SSE = [
    'data: {"type":"response.output_text.delta","delta":"Hel","item_id":"m1"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"lo","item_id":"m1"}\n\n',
    'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":5,"output_tokens":2}}}\n\n',
  ].join('');

  function sameOrigin(status: number, location: (base: string) => string, body = OK_BODY, type = 'application/json'): void {
    origin.plan = (request) => request.url.startsWith('/v2/')
      ? { status: 200, headers: { 'content-type': type }, body }
      : { status, headers: { location: location(origin.base) } };
  }

  it.each([307, 308])('is followed for text with status %i, keeping method, body and headers', async (status) => {
    sameOrigin(status, (base) => `${base}/v2/responses`);
    const response = await Prism.text().using('openai', 'gpt-4o', { apiKey: KEY, organization: ORGANIZATION, url: `${origin.base}/v1` }).withPrompt('Hi').asText();

    expect(response.text).toBe('Hello.');
    expect(origin.received).toHaveLength(2);
    const [first, second] = origin.received;
    expect(second?.method).toBe('POST');
    expect(second?.url).toBe('/v2/responses');
    expect(second?.body).toBe(first?.body);
    expect(second?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(second?.headers['openai-organization']).toBe(ORGANIZATION);
  });

  it('is followed for a stream', async () => {
    sameOrigin(307, (base) => `${base}/v2/responses`, SSE, 'text/event-stream');
    let text = '';
    for await (const event of Prism.text().using('openai', 'gpt-4o', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asStream()) {
      if ('delta' in event && typeof event.delta === 'string') text += event.delta;
    }

    expect(text).toBe('Hello');
    expect(origin.received.map((request) => request.url)).toEqual(['/v1/responses', '/v2/responses']);
    expect(origin.received[1]?.method).toBe('POST');
  });

  it.each([
    ['an absolute path', () => '/v2/responses'],
    ['a relative path', () => '../v2/responses'],
  ])('resolves a Location given as %s against the same origin', async (_label, location) => {
    sameOrigin(307, location);
    const response = await Prism.text().using('openai', 'gpt-4o', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asText();

    expect(response.text).toBe('Hello.');
    expect(origin.received.map((request) => request.url)).toEqual(['/v1/responses', '/v2/responses']);
  });

  it('stops after five hops for text, as the reference does', async () => {
    origin.plan = () => ({ status: 307, headers: { location: '/v1/loop' } });
    const error = await outcome(() => Prism.text().using('openai', 'gpt-4o', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asText());

    expect(error).toBeInstanceOf(PrismUrlRefused);
    expect((error as PrismUrlRefused).code).toBe('too_many_redirects');
    expect(origin.received).toHaveLength(6);
  });

  it('refuses a same-origin Location carrying userinfo for text', async () => {
    origin.plan = (request) => ({ status: 307, headers: { location: `http://fixture-user:fixture-pass@127.0.0.1:${origin.port}${request.url}` } });
    const error = await outcome(() => Prism.text().using('openai', 'gpt-4o', { apiKey: KEY, url: `${origin.base}/v1` }).withPrompt('Hi').asText());

    expect(error).toBeInstanceOf(PrismUrlRefused);
    expect((error as PrismUrlRefused).code).toBe('redirect_refused');
    expect(origin.received).toHaveLength(1);
    expect(String((error as Error).message)).not.toContain('fixture-pass');
  });

  it('refuses a per-call url carrying userinfo with a coded error that does not echo it', async () => {
    const error = await outcome(() => Prism.text().using('openai', 'gpt-4o', { apiKey: KEY, url: `http://fixture-user:fixture-pass@127.0.0.1:${origin.port}/v1` }).withPrompt('Hi').asText());

    expect(error).toBeInstanceOf(PrismError);
    expect((error as PrismError).code).toBe('scheme_not_allowed');
    expect(origin.received).toHaveLength(0);
    expect(String((error as Error).message)).not.toContain('fixture-user');
    expect(String((error as Error).message)).not.toContain('fixture-pass');
  });

  it('is followed for an openai batch retrieve GET', async () => {
    const batch = JSON.stringify({ id: 'batch_1', object: 'batch', status: 'completed', created_at: 1, request_counts: { total: 0, completed: 0, failed: 0 } });
    origin.plan = (request) => request.url.startsWith('/v2/')
      ? { status: 200, headers: { 'content-type': 'application/json' }, body: batch }
      : { status: 301, headers: { location: '/v2/batches/batch_1' } };
    const job = await Prism.batch().using('openai', { apiKey: KEY, url: `${origin.base}/v1` }).retrieve('batch_1');

    expect(job.id).toBe('batch_1');
    expect(origin.received.map((request) => `${request.method} ${request.url}`)).toEqual(['GET /v1/batches/batch_1', 'GET /v2/batches/batch_1']);
    expect(origin.received[1]?.headers.authorization).toBe(`Bearer ${KEY}`);
  });
});

describe('the default transports', () => {
  function post(url: string, clientOptions: Record<string, unknown> = {}): HttpRequest {
    return { url, method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY }, body: '{"prompt":"Hi"}', clientOptions };
  }

  const transports = [
    ['send', (request: HttpRequest) => fetchTransport(request)],
    ['stream', (request: HttpRequest) => fetchStreamTransport(request)],
    ['binary', (request: HttpRequest) => fetchBinaryTransport(request)],
  ] as const;

  describe.each(transports)('%s', (_name, send) => {
    it.each(STATUSES.flatMap((status) => (['another host', 'another port'] as const).map((name) => [status, name] as const)))(
      'does not follow a %i to %s',
      async (status, targetName) => {
        redirectEverythingTo(status, target(targetName));
        expectRefused(await outcome(() => send(post(`${origin.base}/v1/messages`))), target(targetName));
      },
    );

    it('does not follow a Location that only changes the scheme', async () => {
      origin.plan = (request) => ({ status: 307, headers: { location: `https://127.0.0.1:${origin.port}${request.url}` } });
      expectRefused(await outcome(() => send(post(`${origin.base}/v1/messages`))), otherHost);
    });

    it('does not follow a scheme-relative Location to another host', async () => {
      origin.plan = (request) => ({ status: 302, headers: { location: `//127.0.0.2:${otherHost.port}${request.url}` } });
      expectRefused(await outcome(() => send(post(`${origin.base}/v1/messages`))), otherHost);
    });

    it('keeps the policy when client options ask fetch to follow redirects', async () => {
      redirectEverythingTo(307, otherHost);
      expectRefused(await outcome(() => send(post(`${origin.base}/v1/messages`, { redirect: 'follow' }))), otherHost);
    });

    it('stops a same-origin redirect loop', async () => {
      origin.plan = () => ({ status: 307, headers: { location: '/v1/loop' } });
      const error = await outcome(() => send(post(`${origin.base}/v1/messages`)));

      expect(error).toBeInstanceOf(PrismUrlRefused);
      expect((error as PrismUrlRefused).code).toBe('too_many_redirects');
      // The reference follows five redirects and refuses the sixth: one
      // request, five followed hops, and nothing after that.
      expect(origin.received).toHaveLength(6);
    });

    it('follows a chain of exactly five same-origin redirects', async () => {
      origin.plan = () => origin.received.length <= 5
        ? { status: 307, headers: { location: `/v1/hop-${origin.received.length}` } }
        : { status: 200, headers: { 'content-type': 'application/json' }, body: '{}' };
      const response = await send(post(`${origin.base}/v1/messages`));

      expect(response.status).toBe(200);
      expect(origin.received).toHaveLength(6);
    });

    it.each([
      ['a user and password', 'fixture-user:fixture-pass@'],
      ['a user only', 'fixture-user@'],
    ])('refuses a same-origin Location carrying %s, without echoing it', async (_label, userinfo) => {
      origin.plan = (request) => ({ status: 307, headers: { location: `http://${userinfo}127.0.0.1:${origin.port}${request.url}` } });
      const error = await outcome(() => send(post(`${origin.base}/v1/messages`)));

      expect(error).toBeInstanceOf(PrismUrlRefused);
      expect((error as PrismUrlRefused).code).toBe('redirect_refused');
      expect(origin.received).toHaveLength(1);
      expect(String((error as Error).message)).not.toContain('fixture-user');
      expect(String((error as Error).message)).not.toContain('fixture-pass');
    });

    it('turns the platform refusal of a url carrying userinfo into a coded error that does not echo it', async () => {
      const error = await outcome(() => send(post(`http://fixture-user:fixture-pass@127.0.0.1:${origin.port}/v1/messages`)));

      expect(error).toBeInstanceOf(PrismError);
      expect((error as PrismError).code).toBe('scheme_not_allowed');
      expect(origin.received).toHaveLength(0);
      const text = `${String((error as Error).message)} ${String((error as Error).stack)}`;
      expect(text).not.toContain('fixture-user');
      expect(text).not.toContain('fixture-pass');
      expect(text).not.toContain('127.0.0.1');
    });

    it('leaves a url carrying userinfo to the fetch it was given', async () => {
      // The transport does not decide for the platform: a fetch that can send
      // such a url (a wrapper, a proxy, another runtime) is handed it as is.
      const seen: string[] = [];
      vi.stubGlobal('fetch', (input: string | URL | Request) => {
        seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return Promise.resolve(new Response('{"error":{"message":"fixture"}}', { status: 500, headers: { 'content-type': 'application/json' } }));
      });
      const response = await send(post('https://fixture-user@gateway.example/v1/messages'));

      expect(response.status).toBe(500);
      expect(seen).toEqual(['https://fixture-user@gateway.example/v1/messages']);
    });

    it.each([303, 301, 302])('turns a POST answered with %i into a GET without a body', async (status) => {
      origin.plan = (request) => request.url === '/v1/after'
        ? { status: 200, headers: { 'content-type': 'application/json' }, body: '{}' }
        : { status, headers: { location: '/v1/after' } };
      const response = await send(post(`${origin.base}/v1/messages`));

      expect(response.status).toBe(200);
      expect(origin.received).toHaveLength(2);
      expect(origin.received[1]?.method).toBe('GET');
      expect(origin.received[1]?.body).toBe('');
      expect(origin.received[1]?.headers['content-type']).toBeUndefined();
      expect(origin.received[1]?.headers['x-api-key']).toBe(KEY);
    });

    it('returns a redirect status with no Location as the response', async () => {
      origin.plan = () => ({ status: 300, headers: { 'content-type': 'application/json' }, body: '{}' });
      const response = await send(post(`${origin.base}/v1/messages`));

      expect(response.status).toBe(300);
      expect(origin.received).toHaveLength(1);
    });
  });
});

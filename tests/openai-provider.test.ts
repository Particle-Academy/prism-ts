import { describe, expect, it } from 'vitest';
import { OpenAI, Prism, PrismError } from '../src/index.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/index.js';

const OK_BODY = {
  id: 'resp_1',
  model: 'gpt-4o',
  status: 'completed',
  output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'Hello.' }] }],
  usage: { input_tokens: 10, output_tokens: 2 },
};

function recordingTransport(response: Partial<HttpResponse> = {}): {
  transport: HttpTransport;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];

  const transport: HttpTransport = (request) => {
    calls.push(request);

    return Promise.resolve({
      status: 200,
      headers: {},
      body: OK_BODY,
      rawBody: JSON.stringify(OK_BODY),
      ...response,
    });
  };

  return { transport, calls };
}

describe('OpenAI provider', () => {
  it('posts canonical JSON to the responses endpoint and parses the reply', async () => {
    const { transport, calls } = recordingTransport();

    const response = await Prism.text()
      .using('openai', 'gpt-4o', { apiKey: 'sk-test', url: 'https://api.example.test/v1', transport })
      .withPrompt('Hi')
      .asText();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.test/v1/responses');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBe(
      '{"model":"gpt-4o","input":[{"role":"user","content":[{"type":"input_text","text":"Hi"}]}],"max_output_tokens":null}',
    );
    expect(response.text).toBe('Hello.');
  });

  it('runs the asText callback with the pending request and the response', async () => {
    const { transport } = recordingTransport();
    const seen: string[] = [];

    await Prism.text()
      .using('openai', 'gpt-4o', { apiKey: 'sk-test', transport })
      .withPrompt('Hi')
      .asText((pending, response) => {
        seen.push(`${pending.model()}:${response.text}`);
      });

    expect(seen).toEqual(['gpt-4o:Hello.']);
  });

  it('omits the organization and project headers when they are not configured', () => {
    const headers = new OpenAI({ apiKey: 'sk-test', organization: null, project: null }).headers();

    expect(headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' });
  });

  it('sends the organization and project headers when they are configured', () => {
    const headers = new OpenAI({ apiKey: 'sk-test', organization: 'org_1', project: 'proj_1' }).headers();

    expect(headers['OpenAI-Organization']).toBe('org_1');
    expect(headers['OpenAI-Project']).toBe('proj_1');
  });

  it('sends no Authorization header without an api key', () => {
    expect(new OpenAI({ apiKey: '' }).headers()).not.toHaveProperty('Authorization');
  });

  it('reads configuration from the environment when it is not given explicitly', () => {
    process.env.OPENAI_URL = 'https://env.example.test/v1';
    process.env.OPENAI_ORGANIZATION = 'org_from_env';

    try {
      const provider = new OpenAI();

      expect(provider.url).toBe('https://env.example.test/v1');
      expect(provider.organization).toBe('org_from_env');
    } finally {
      delete process.env.OPENAI_URL;
      delete process.env.OPENAI_ORGANIZATION;
    }
  });

  it('defaults to the public api url', () => {
    expect(new OpenAI({ apiKey: 'sk-test' }).url).toBe('https://api.openai.com/v1');
  });

  it('turns an http failure into a coded error carrying the status and body', async () => {
    const failure = { error: { type: 'invalid_request_error', message: 'nope' } };
    const { transport } = recordingTransport({ status: 400, body: failure, rawBody: JSON.stringify(failure) });

    const promise = Prism.text()
      .using('openai', 'gpt-4o', { apiKey: 'sk-test', transport })
      .withPrompt('Hi')
      .asText();

    await expect(promise).rejects.toBeInstanceOf(PrismError);
    await expect(promise).rejects.toMatchObject({
      code: 'provider_response_error',
      httpStatus: 400,
      responseBody: JSON.stringify(failure),
    });
  });

  it('refuses the chat-completions api format, which is not ported', async () => {
    const { transport } = recordingTransport();

    await expect(
      Prism.text()
        .using('openai', 'gpt-4o', { apiKey: 'sk-test', apiFormat: 'chat_completions', transport })
        .withPrompt('Hi')
        .asText(),
    ).rejects.toMatchObject({ code: 'unsupported_provider_action' });
  });

  it('reports rate limits read off the response headers', async () => {
    const { transport } = recordingTransport({
      headers: {
        'x-ratelimit-limit-tokens': '30000',
        'x-ratelimit-remaining-tokens': '29000',
        'x-ratelimit-reset-tokens': '6s',
      },
    });

    const response = await Prism.text()
      .using('openai', 'gpt-4o', { apiKey: 'sk-test', transport })
      .withPrompt('Hi')
      .asText();

    expect(response.meta.rateLimits).toHaveLength(1);
    expect(response.meta.rateLimits[0]?.name).toBe('tokens');
    expect(response.meta.rateLimits[0]?.limit).toBe(30_000);
    expect(response.meta.rateLimits[0]?.resetsAt).toBeInstanceOf(Date);
  });

  it('throws with a code for every capability it does not implement', () => {
    const provider = new OpenAI({ apiKey: 'sk-test' });

    // `structured` left this list when the capability shipped. It is asserted
    // by StructuredTest instead, which is the point of listing them by name
    // rather than reflecting over the class: implementing one has to be a
    // deliberate edit here.
    for (const capability of ['embeddings', 'images', 'moderation', 'fim'] as const) {
      try {
        provider[capability](undefined);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as PrismError).code).toBe('unsupported_provider_action');
      }
    }
  });
});

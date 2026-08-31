import { describe, expect, it } from 'vitest';
import { Prism, PrismError, parseImagesResponse } from '../src/index.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/index.js';

function transportReturning(body: unknown, status = 200): { transport: HttpTransport; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];

  const transport: HttpTransport = (request) => {
    calls.push(request);

    return Promise.resolve({ status, headers: {}, body, rawBody: JSON.stringify(body) } as HttpResponse);
  };

  return { transport, calls };
}

const OK = {
  id: 'img_1',
  model: 'gpt-image-1',
  data: [{ b64_json: 'aGk=', revised_prompt: 'a cat, photographic, soft light' }],
  usage: { input_tokens: 12, output_tokens: 300 },
};

describe('images', () => {
  it('posts the prompt to the generations endpoint and returns the image', async () => {
    const { transport, calls } = transportReturning(OK);

    const response = await Prism.images()
      .using('openai', 'gpt-image-1', { apiKey: 'sk-test', transport })
      .withPrompt('a cat')
      .generate();

    expect(calls[0]?.url).toContain('/images/generations');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ model: 'gpt-image-1', prompt: 'a cat' });
    expect(response.firstImage()?.base64).toBe('aGk=');
    expect(response.firstImage()?.url).toBeNull();
  });

  it('keeps the revised prompt the provider actually generated from', async () => {
    // OpenAI rewrites prompts, often substantially. A caller comparing an image
    // against its prompt is comparing it against THIS one, not the one they typed.
    const { transport } = transportReturning(OK);

    const response = await Prism.images()
      .using('openai', 'gpt-image-1', { apiKey: 'sk-test', transport })
      .withPrompt('a cat')
      .generate();

    expect(response.firstImage()?.hasRevisedPrompt()).toBe(true);
    expect(response.firstImage()?.revisedPrompt).toBe('a cat, photographic, soft light');
  });

  it('reads both usage spellings, because the image endpoints disagree', async () => {
    // gpt-image-1 reports input/output tokens; DALL·E reports prompt/completion.
    // Reading only one would report zero cost for the other.
    const dalle = parseImagesResponse(
      { id: 'i', model: 'dall-e-3', data: [{ url: 'https://x/y.png' }], usage: { prompt_tokens: 7, completion_tokens: 0 } },
      'dall-e-3',
    );

    expect(dalle.usage.promptTokens).toBe(7);
    expect(parseImagesResponse(OK, 'gpt-image-1').usage.promptTokens).toBe(12);
  });

  it('reports a missing url as null rather than an empty string', () => {
    // A missing url and an empty one are different answers.
    const response = parseImagesResponse({ data: [{ b64_json: 'aGk=' }] }, 'gpt-image-1');

    expect(response.firstImage()?.url).toBeNull();
  });

  it('returns null from firstImage when the provider returned none', () => {
    // The provider answered; it just answered with nothing. `raw` says why.
    expect(parseImagesResponse({ data: [] }, 'gpt-image-1').firstImage()).toBeNull();
  });

  it('refuses a request with no prompt', () => {
    expect(() => Prism.images().using('openai', 'gpt-image-1', { apiKey: 'sk-test' }).toRequest()).toThrowError(
      PrismError,
    );
  });

  it('falls back to the requested model when the response omits it', () => {
    expect(parseImagesResponse({ data: [] }, 'gpt-image-1').meta.model).toBe('gpt-image-1');
  });

  it('passes provider options through and omits the ones not set', async () => {
    const { transport, calls } = transportReturning(OK);

    await Prism.images()
      .using('openai', 'gpt-image-1', { apiKey: 'sk-test', transport })
      .withPrompt('a cat')
      .withProviderOptions({ size: '1024x1024', n: 2 })
      .generate();

    const sent = JSON.parse(calls[0]?.body ?? '{}');

    expect(sent.size).toBe('1024x1024');
    expect(sent.n).toBe(2);
    expect(sent).not.toHaveProperty('quality');
  });
});

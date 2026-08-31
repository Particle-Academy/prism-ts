import { describe, expect, it } from 'vitest';
import { Embedding, Prism, PrismError, parseEmbeddingsResponse } from '../src/index.js';
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
  id: 'emb_1',
  model: 'text-embedding-3-small',
  data: [
    { index: 0, embedding: [0.1, 0.2] },
    { index: 1, embedding: [0.3, 0.4] },
  ],
  usage: { total_tokens: 9 },
};

describe('embeddings', () => {
  it('posts every input as a list and returns one vector each', async () => {
    const { transport, calls } = transportReturning(OK);

    const response = await Prism.embeddings()
      .using('openai', 'text-embedding-3-small', { apiKey: 'sk-test', transport })
      .fromInput('first')
      .fromInput('second')
      .asEmbeddings();

    expect(calls[0]?.url).toContain('/embeddings');
    // A list even for one input, so the response index maps to the input index
    // without a special case.
    expect(JSON.parse(calls[0]?.body ?? '{}').input).toEqual(['first', 'second']);
    expect(response.embeddings).toHaveLength(2);
    expect(response.embeddings[0]?.embedding).toEqual([0.1, 0.2]);
    expect(response.usage.tokens).toBe(9);
    expect(response.meta.model).toBe('text-embedding-3-small');
  });

  it('orders vectors by the provider index, not by arrival', async () => {
    // The API documents that `data` may come back out of order, and callers zip
    // the result against the inputs they sent — so trusting arrival order would
    // attach every vector to the wrong text.
    const { transport } = transportReturning({
      ...OK,
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    });

    const response = await Prism.embeddings()
      .using('openai', 'text-embedding-3-small', { apiKey: 'sk-test', transport })
      .fromArray(['first', 'second'])
      .asEmbeddings();

    expect(response.embeddings[0]?.embedding).toEqual([0.1, 0.2]);
    expect(response.embeddings[1]?.embedding).toEqual([0.3, 0.4]);
  });

  it('refuses a request with no input', () => {
    // Billable, comes back empty, and reads as a provider that answered nothing.
    expect(() =>
      Prism.embeddings().using('openai', 'text-embedding-3-small', { apiKey: 'sk-test' }).toRequest(),
    ).toThrowError(PrismError);
  });

  it('reports no token count as null rather than zero', async () => {
    // A caller totalling spend needs "this cost nothing" to differ from "nobody
    // told me what this cost".
    const { transport } = transportReturning({ ...OK, usage: undefined });

    const response = await Prism.embeddings()
      .using('openai', 'text-embedding-3-small', { apiKey: 'sk-test', transport })
      .fromInput('x')
      .asEmbeddings();

    expect(response.usage.tokens).toBeNull();
  });

  it('drops a non-numeric member rather than coercing it to zero', () => {
    // Number(null) is 0, which would push a zero into the vector and shift
    // every distance computed against it. A shorter vector is a visible fault.
    expect(Embedding.fromArray([0.1, null, 0.2]).embedding).toEqual([0.1, 0.2]);
  });

  it('passes provider options through and omits the ones not set', async () => {
    const { transport, calls } = transportReturning(OK);

    await Prism.embeddings()
      .using('openai', 'text-embedding-3-small', { apiKey: 'sk-test', transport })
      .fromInput('x')
      .withProviderOptions({ dimensions: 256 })
      .asEmbeddings();

    const sent = JSON.parse(calls[0]?.body ?? '{}');

    expect(sent.dimensions).toBe(256);
    expect(sent).not.toHaveProperty('encoding_format');
  });

  it('refuses an empty provider response rather than returning no vectors', () => {
    expect(() => parseEmbeddingsResponse(null)).toThrowError(PrismError);
  });

  it('reports an unreadable input file against the path that was named', () => {
    expect(() =>
      Prism.embeddings()
        .using('openai', 'text-embedding-3-small', { apiKey: 'sk-test' })
        .fromFile('does/not/exist.txt'),
    ).toThrowError(/does\/not\/exist\.txt/);
  });
});

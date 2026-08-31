import { describe, expect, it } from 'vitest';
import { ModerationResult, Prism, PrismError, parseModerationResponse } from '../src/index.js';
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
  id: 'modr_1',
  model: 'omni-moderation-latest',
  results: [
    { flagged: false, categories: { violence: false }, category_scores: { violence: 0.01 } },
    { flagged: true, categories: { violence: true, hate: false }, category_scores: { violence: 0.98 } },
  ],
};

describe('moderation', () => {
  it('posts every input and reports a verdict for each', async () => {
    const { transport, calls } = transportReturning(OK);

    const response = await Prism.moderation()
      .using('openai', 'omni-moderation-latest', { apiKey: 'sk-test', transport })
      .withInput('safe', 'not safe')
      .asModeration();

    expect(calls[0]?.url).toContain('/moderations');
    expect(JSON.parse(calls[0]?.body ?? '{}').input).toEqual(['safe', 'not safe']);
    expect(response.results).toHaveLength(2);
  });

  it('reports flagged when ANY input was flagged, not just the first', async () => {
    // The question nearly every caller asks, and the one most likely to be got
    // wrong by hand: checking results[0] alone passes a batch whose SECOND
    // input was the problem.
    const { transport } = transportReturning(OK);

    const response = await Prism.moderation()
      .using('openai', 'omni-moderation-latest', { apiKey: 'sk-test', transport })
      .withInput('safe', 'not safe')
      .asModeration();

    expect(response.isFlagged()).toBe(true);
    expect(response.firstFlagged()?.flaggedCategories()).toEqual(['violence']);
    expect(response.flagged()).toHaveLength(1);
  });

  it('refuses a request with no input rather than failing open', async () => {
    // An empty call returns no results, isFlagged() is then false, and a caller
    // gating on it lets everything through. A safety check that fails OPEN
    // because it was called wrong is the worst shape in the package.
    expect(() =>
      Prism.moderation().using('openai', 'omni-moderation-latest', { apiKey: 'sk-test' }).toRequest(),
    ).toThrowError(PrismError);
  });

  it('refuses a malformed provider reply rather than reporting nothing flagged', () => {
    // Same reasoning: an empty response reads as "nothing was flagged".
    expect(() => parseModerationResponse(null, 'omni-moderation-latest')).toThrowError(PrismError);
  });

  it('drops a non-boolean category rather than coercing it', () => {
    // Coercion would make the STRING "false" into true, and this is the one
    // value object where a wrong true means content gets blocked.
    const result = ModerationResult.fromObject({
      flagged: false,
      categories: { violence: 'false', hate: true },
      category_scores: { violence: 'high', hate: 0.9 },
    });

    expect(result.categories).toEqual({ hate: true });
    expect(result.categoryScores).toEqual({ hate: 0.9 });
  });

  it('treats a missing flagged field as not flagged, and says so explicitly', () => {
    // `flagged === true` rather than truthiness: a provider that omitted the
    // field has not told us it is safe, but reporting `true` on absence would
    // block everything a malformed reply touched.
    expect(ModerationResult.fromObject({}).flagged).toBe(false);
  });

  it('falls back to the requested model when the response omits it', () => {
    expect(parseModerationResponse({ results: [] }, 'omni-moderation-latest').meta.model).toBe(
      'omni-moderation-latest',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  AssistantMessage,
  FinishReason,
  Prism,
  PrismError,
  mapFinishReason,
  mapFinishReasonFromOutput,
  parseTextResponse,
} from '../src/index.js';
import type { JsonObject, TextRequest } from '../src/index.js';

const request = (): TextRequest => Prism.text().using('openai', 'gpt-4o').withPrompt('Who are you?').toRequest();

const completed = (overrides: JsonObject = {}): JsonObject => ({
  id: 'resp_1',
  model: 'gpt-4o-2024-08-06',
  status: 'completed',
  service_tier: 'default',
  output: [
    {
      type: 'message',
      status: 'completed',
      content: [{ type: 'output_text', text: 'I am a model.' }],
    },
  ],
  usage: {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens: 12,
    output_tokens_details: { reasoning_tokens: 5 },
  },
  ...overrides,
});

describe('parseTextResponse', () => {
  it('reads the text, finish reason and metadata off a completed response', () => {
    const response = parseTextResponse(request(), completed());

    expect(response.text).toBe('I am a model.');
    expect(response.finishReason).toBe(FinishReason.Stop);
    expect(response.meta.id).toBe('resp_1');
    expect(response.meta.model).toBe('gpt-4o-2024-08-06');
    expect(response.meta.serviceTier).toBe('default');
  });

  it('reports prompt tokens NET of the cached ones', () => {
    const response = parseTextResponse(request(), completed());

    expect(response.usage.promptTokens).toBe(60);
    expect(response.usage.cacheReadInputTokens).toBe(40);
    expect(response.usage.completionTokens).toBe(12);
    expect(response.usage.thoughtTokens).toBe(5);
  });

  it('appends the reply to the conversation it was given', () => {
    const response = parseTextResponse(request(), completed());
    const last = response.messages.at(-1);

    expect(response.messages).toHaveLength(2);
    expect(last).toBeInstanceOf(AssistantMessage);
    expect((last as AssistantMessage).content).toBe('I am a model.');
  });

  it('records exactly one step, carrying the raw payload', () => {
    const response = parseTextResponse(request(), completed());

    expect(response.steps).toHaveLength(1);
    expect(response.steps[0]?.raw).toEqual(completed());
    expect(response.steps[0]?.additionalContent).toEqual({ reasoningSummaries: [] });
  });

  it('falls back to empty text when the last output item carries none', () => {
    const response = parseTextResponse(request(), completed({ output: [{ type: 'message', status: 'completed' }] }));

    expect(response.text).toBe('');
  });

  it('throws with a code when generation ran out of output tokens', () => {
    const payload = completed({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });

    try {
      parseTextResponse(request(), payload);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PrismError);
      expect((error as PrismError).code).toBe('max_tokens_exceeded');
    }
  });

  it('throws with a code when the response finished on tool calls', () => {
    const payload = completed({
      output: [{ type: 'function_call', status: 'completed', id: 'fc_1', call_id: 'call_1', name: 'weather', arguments: '{}' }],
    });

    try {
      parseTextResponse(request(), payload);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as PrismError).code).toBe('tool_loop_not_supported');
    }
  });

  it('throws with a code for an error payload, an empty payload, and a non-object', () => {
    for (const payload of [{ error: { type: 'invalid_request_error', message: 'bad' } }, {}, null, 'nope']) {
      try {
        parseTextResponse(request(), payload);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as PrismError).code).toBe('provider_response_error');
      }
    }
  });

  it('collects web search activity into the step', () => {
    const payload = completed({
      output: [
        { type: 'web_search_call', action: { type: 'search', query: 'prism' } },
        { type: 'web_search_call', action: { type: 'search', query: 'prism' } },
        { type: 'web_search_call', action: { type: 'open_page', url: 'https://example.com' } },
        { type: 'reasoning', summary: [{ text: 'considering' }] },
        { type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'done' }] },
      ],
    });

    expect(parseTextResponse(request(), payload).steps[0]?.additionalContent).toEqual({
      searchQueries: ['prism'],
      openPageUrls: ['https://example.com'],
      reasoningSummaries: ['considering'],
    });
  });
});

describe('mapFinishReason', () => {
  it('maps a completed message to Stop and a completed call to ToolCalls', () => {
    expect(mapFinishReasonFromOutput('completed', 'message')).toBe(FinishReason.Stop);
    expect(mapFinishReasonFromOutput('completed', 'function_call')).toBe(FinishReason.ToolCalls);
    expect(mapFinishReasonFromOutput('completed', 'web_search_call')).toBe(FinishReason.ToolCalls);
    expect(mapFinishReasonFromOutput('completed', 'something_else')).toBe(FinishReason.Unknown);
    expect(mapFinishReasonFromOutput('failed', 'message')).toBe(FinishReason.Error);
    expect(mapFinishReasonFromOutput('length', 'message')).toBe(FinishReason.Length);
    expect(mapFinishReasonFromOutput('', '')).toBe(FinishReason.Unknown);
  });

  it('lets a top-level incomplete status win over the output items', () => {
    expect(mapFinishReason({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] })).toBe(
      FinishReason.Length,
    );
    expect(mapFinishReason({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] })).toBe(
      FinishReason.ContentFilter,
    );
  });

  it('treats an EMPTY output array as no last item at all', () => {
    // "the last element of an empty list" is where a port quietly produces
    // undefined and maps it to something confident and wrong.
    expect(mapFinishReason({ output: [] })).toBe(FinishReason.Unknown);
    expect(mapFinishReason({})).toBe(FinishReason.Unknown);
  });
});

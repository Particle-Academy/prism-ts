import { describe, expect, it } from 'vitest';
import { Prism, PrismError } from '../src/index.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/index.js';

const OK_BODY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{ type: 'text', text: 'Hello.' }],
  stop_reason: 'end_turn',
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

function bodyOf(call: HttpRequest | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.body ?? '{}')) as Record<string, unknown>;
}

describe('Anthropic provider', () => {
  it('posts to the messages endpoint and parses the reply', async () => {
    const { transport, calls } = recordingTransport();

    const response = await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', url: 'https://api.example.test/v1', transport })
      .withPrompt('Hi')
      .withMaxTokens(64)
      .asText();

    expect(calls[0]?.url).toBe('https://api.example.test/v1/messages');
    expect(response.text).toBe('Hello.');
    expect(response.usage.promptTokens).toBe(10);
  });

  it('authenticates with x-api-key and pins the version header', async () => {
    // Anthropic does not take a bearer token, and the version header decides the
    // response SHAPE — a floating one would let a provider release change what
    // the parser receives without a line of code changing here.
    const { transport, calls } = recordingTransport();

    await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', transport })
      .withPrompt('Hi')
      .asText();

    expect(calls[0]?.headers['x-api-key']).toBe('sk-test');
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('always sends max_tokens, because Anthropic requires it', async () => {
    // The OpenAI body sends an explicit null for an unset limit. Doing that
    // here is a 400, so a default has to be chosen rather than omitted.
    const { transport, calls } = recordingTransport();

    await Prism.text().using('anthropic', 'claude-sonnet-4-5', { transport }).withPrompt('Hi').asText();

    expect(bodyOf(calls[0]).max_tokens).toBe(4096);
  });

  it('carries system prompts in the top-level system field, not in messages', async () => {
    const { transport, calls } = recordingTransport();

    await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { transport })
      .withSystemPrompt('Be brief.')
      .withPrompt('Hi')
      .asText();

    const body = bodyOf(calls[0]);

    expect(body.system).toBe('Be brief.');
    expect(JSON.stringify(body.messages)).not.toContain('Be brief.');
  });

  it('omits tools entirely rather than sending an empty array', async () => {
    // An empty array is truthy in JavaScript, and sending it changes
    // tool_choice defaults on some models and is rejected outright by others.
    const { transport, calls } = recordingTransport();

    await Prism.text().using('anthropic', 'claude-sonnet-4-5', { transport }).withPrompt('Hi').asText();

    expect(bodyOf(calls[0])).not.toHaveProperty('tools');
  });

  it('joins every text block rather than taking the first', async () => {
    // Anthropic splits a reply across blocks when thinking or tool use
    // interleaves. Taking content[0] returns a truncated answer that looks
    // complete.
    const { transport } = recordingTransport({
      body: {
        ...OK_BODY,
        content: [
          { type: 'thinking', thinking: 'considering' },
          { type: 'text', text: 'First. ' },
          { type: 'text', text: 'Second.' },
        ],
      },
    });

    const response = await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { transport })
      .withPrompt('Hi')
      .asText();

    expect(response.text).toBe('First. Second.');
  });

  it('reports cache tokens without subtracting them from the prompt', async () => {
    // Anthropic reports cache tokens SEPARATELY from input_tokens, unlike
    // OpenAI which nests them inside. Subtracting here would under-report.
    const { transport } = recordingTransport({
      body: {
        ...OK_BODY,
        usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 },
      },
    });

    const response = await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { transport })
      .withPrompt('Hi')
      .asText();

    expect(response.usage.promptTokens).toBe(10);
    expect(response.usage.cacheReadInputTokens).toBe(7);
  });

  it('reports the thinking tokens Anthropic actually sends', async () => {
    // Reported by the Moic Suite team against the live API. Anthropic puts
    // reasoning at usage.output_tokens_details.thinking_tokens, and this
    // mapping passed a literal null there -- as did PHP and Python. All three
    // languages agreed, so no cross-language check could see it.
    //
    // The numbers matter as much as the field: 1240 thinking tokens INSIDE
    // 2820 output tokens. A consumer pricing completion + thought would bill
    // the reasoning twice, which is the expensive half.
    const { transport } = recordingTransport({
      body: {
        ...OK_BODY,
        usage: {
          input_tokens: 11,
          output_tokens: 2820,
          output_tokens_details: { thinking_tokens: 1240 },
        },
      },
    });

    const response = await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { transport })
      .withPrompt('Hi')
      .asText();

    expect(response.usage.thoughtTokens).toBe(1240);
    expect(response.usage.completionTokens).toBe(2820);
    // The breakdown claim, asserted rather than left to the comment.
    expect(response.usage.thoughtTokens!).toBeLessThan(response.usage.completionTokens);
  });

  it('leaves thoughtTokens null when Anthropic reports no thinking', async () => {
    // The control. Without it the test above passes against a mapping that
    // hardcodes 1240, and against one that invents a number when none was sent
    // -- which would make "the model did not reason" unreadable.
    const { transport } = recordingTransport({
      body: { ...OK_BODY, usage: { input_tokens: 11, output_tokens: 2820 } },
    });

    const response = await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { transport })
      .withPrompt('Hi')
      .asText();

    expect(response.usage.thoughtTokens).toBeNull();
  });

  it('raises on an error body even when the status is not a failure', async () => {
    // Anthropic reports some failures with type: "error" and a 200.
    const { transport } = recordingTransport({
      body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    });

    await expect(
      Prism.text().using('anthropic', 'claude-sonnet-4-5', { transport }).withPrompt('Hi').asText(),
    ).rejects.toThrow(PrismError);
  });

  it('raises when generation was cut short', async () => {
    const { transport } = recordingTransport({ body: { ...OK_BODY, stop_reason: 'max_tokens' } });

    await expect(
      Prism.text().using('anthropic', 'claude-sonnet-4-5', { transport }).withPrompt('Hi').asText(),
    ).rejects.toThrow(PrismError);
  });

  it('treats an unrecognised stop reason as unknown rather than as a clean stop', async () => {
    // Guessing Stop would present a truncated or refused generation as a
    // complete one.
    const { transport } = recordingTransport({ body: { ...OK_BODY, stop_reason: 'something_new' } });

    const response = await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { transport })
      .withPrompt('Hi')
      .asText();

    expect(response.finishReason).toBe('unknown');
  });
});

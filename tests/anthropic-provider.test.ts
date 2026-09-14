import { describe, expect, it } from 'vitest';
import {
  AssistantMessage,
  FinishReason,
  Prism,
  PrismError,
  ToolCall,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from '../src/index.js';
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

  it('returns a truncated generation rather than throwing', async () => {
    // A Length finish RETURNS the partial answer, matching the reference. This
    // test asserted the opposite until 2026-09-06 (G-50): both ports threw for
    // every provider, which matched the reference on OpenAI and diverged from it
    // on Anthropic and Mistral.
    //
    // The text and the usage are the point. The model wrote something usable and
    // the tokens were paid for, and running out of room is exactly when the usage
    // numbers matter most -- so throwing discarded the counts on the one call
    // where a caller most wants them.
    const { transport } = recordingTransport({
      body: {
        ...OK_BODY,
        stop_reason: 'max_tokens',
        usage: { input_tokens: 11, output_tokens: 2820, output_tokens_details: { thinking_tokens: 1240 } },
      },
    });

    const response = await Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { transport })
      .withPrompt('Hi')
      .asText();

    // Length, not Stop: the caller has to be able to tell a truncated answer
    // from a complete one, which is the whole cost of not throwing.
    expect(response.finishReason).toBe(FinishReason.Length);
    expect(response.text).toBeTruthy();
    expect(response.usage.thoughtTokens).toBe(1240);
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

  describe('thinking options (G-57)', () => {
    async function bodyFor(configure: (pending: ReturnType<typeof Prism.text>) => ReturnType<typeof Prism.text>) {
      const { transport, calls } = recordingTransport();

      await configure(Prism.text().using('anthropic', 'claude-sonnet-4-6', { transport }).withPrompt('Hi')).asText();

      return bodyOf(calls[0]);
    }

    it("spells Prism's enabled shape the way Anthropic takes it", async () => {
      // Sent as given this was a 400, so a mode that worked in PHP failed here.
      const body = await bodyFor((pending) =>
        pending.withProviderOptions({ thinking: { enabled: true, budgetTokens: 2048 } }),
      );

      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    });

    it('falls back to the minimum budget when none is an integer', async () => {
      for (const budgetTokens of [undefined, '4000', 1.5]) {
        const body = await bodyFor((pending) =>
          pending.withProviderOptions({ thinking: { enabled: true, ...(budgetTokens === undefined ? {} : { budgetTokens }) } }),
        );

        expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
      }
    });

    it('sends adaptive thinking, and effort as output_config', async () => {
      const body = await bodyFor((pending) =>
        pending.withProviderOptions({ thinking: { type: 'adaptive' }, effort: 'medium' }),
      );

      expect(body.thinking).toEqual({ type: 'adaptive' });
      expect(body.output_config).toEqual({ effort: 'medium' });
      expect(body).not.toHaveProperty('effort');
    });

    it('sends neither thinking nor output_config when no option asks for them', async () => {
      const body = await bodyFor((pending) => pending);

      expect(body).not.toHaveProperty('thinking');
      expect(body).not.toHaveProperty('output_config');
    });

    it('lets withReasoning(false) win over a thinking option, as the reference does', async () => {
      const body = await bodyFor((pending) =>
        pending.withProviderOptions({ thinking: { type: 'adaptive' } }).withReasoning(false),
      );

      expect(body).not.toHaveProperty('thinking');
    });

    it('keeps the thinking signature from a response and sends the block back first', async () => {
      // Anthropic requires the thinking block, with its signature, on a tool-use
      // turn with thinking on. The text kept is the FIRST block's, because the
      // signature covers exactly that block.
      const { transport, calls } = recordingTransport({
        body: {
          ...OK_BODY,
          content: [
            { type: 'thinking', thinking: 'first', signature: 'sig-1' },
            { type: 'text', text: 'Checking.' },
            { type: 'thinking', thinking: 'second', signature: 'sig-2' },
          ],
        },
      });
      const pending = () =>
        Prism.text()
          .using('anthropic', 'claude-sonnet-4-6', { transport })
          .withProviderOptions({ thinking: { type: 'adaptive' } });

      const first = await pending().withPrompt('Weather?').asText();

      expect(first.additionalContent).toMatchObject({ thinking: 'first', thinking_signature: 'sig-1' });

      await pending()
        .withMessages([
          new UserMessage('Weather?'),
          new AssistantMessage('Checking.', [new ToolCall('toolu_1', 'weather', { city: 'Detroit' })], first.additionalContent),
          new ToolResultMessage([new ToolResult('toolu_1', 'weather', { city: 'Detroit' }, 'Sunny')]),
        ])
        .asText();

      const assistant = (bodyOf(calls[1]).messages as { role: string; content: { type: string }[] }[]).find(
        (message) => message.role === 'assistant',
      );

      expect(assistant?.content[0]).toEqual({ type: 'thinking', thinking: 'first', signature: 'sig-1' });
      expect(assistant?.content.map((block) => block.type)).toEqual(['thinking', 'text', 'tool_use']);
    });

    it('sends back a thinking block whose text was omitted, since its signature is still required', async () => {
      const { transport, calls } = recordingTransport();

      await Prism.text()
        .using('anthropic', 'claude-sonnet-4-6', { transport })
        .withMessages([
          new UserMessage('Weather?'),
          new AssistantMessage('', [new ToolCall('toolu_1', 'weather', {})], { thinking: '', thinking_signature: 'sig-1' }),
          new ToolResultMessage([new ToolResult('toolu_1', 'weather', {}, 'Sunny')]),
        ])
        .asText();

      const assistant = (bodyOf(calls[0]).messages as { role: string; content: unknown[] }[])[1];

      expect(assistant?.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-1' });
    });

    it('sends no thinking block without a signature', async () => {
      const { transport, calls } = recordingTransport();

      await Prism.text()
        .using('anthropic', 'claude-sonnet-4-6', { transport })
        .withMessages([new UserMessage('Hi'), new AssistantMessage('Hello.', [], { thinking: 'hmm' }), new UserMessage('Again')])
        .asText();

      const assistant = (bodyOf(calls[0]).messages as { role: string; content: unknown[] }[])[1];

      expect(assistant?.content).toEqual([{ type: 'text', text: 'Hello.' }]);
    });
  });
});

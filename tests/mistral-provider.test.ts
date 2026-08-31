import { describe, expect, it } from 'vitest';
import { FinishReason, Mistral, Prism, PrismError, Tool, ToolChoice } from '../src/index.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/index.js';

function transportFor(body: unknown, status = 200, headers: Record<string, string> = {}): {
  transport: HttpTransport;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];

  const transport: HttpTransport = (request) => {
    calls.push(request);

    return Promise.resolve({
      status,
      headers,
      body,
      rawBody: JSON.stringify(body),
    } satisfies HttpResponse);
  };

  return { transport, calls };
}

const CHAT = {
  id: 'cmpl-1',
  object: 'chat.completion',
  model: 'mistral-large-latest',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Bonjour' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
};

const sent = (calls: HttpRequest[], index = 0): Record<string, unknown> =>
  JSON.parse(calls[index]?.body ?? '{}') as Record<string, unknown>;

describe('text', () => {
  it('posts the chat-completions shape and reads the reply', async () => {
    const { transport, calls } = transportFor(CHAT);

    const response = await Prism.text()
      .using('mistral', 'mistral-large-latest', { apiKey: 'sk-test', transport })
      .withPrompt('Say hello in French')
      .asText();

    expect(calls[0]?.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk-test');

    const body = sent(calls);
    // `messages`, not the Responses API's `input`. Sharing the OpenAI mapper
    // would send the wrong envelope to an endpoint that looks compatible.
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Say hello in French' }] }]);
    expect(response.text).toBe('Bonjour');
    expect(response.finishReason).toBe(FinishReason.Stop);
    expect(response.usage.promptTokens).toBe(9);
  });

  it('puts system prompts first', async () => {
    // Mistral weights the earliest system turn most heavily, and a caller who
    // set one expects it to lead.
    const { transport, calls } = transportFor(CHAT);

    await Prism.text()
      .using('mistral', 'mistral-large-latest', { apiKey: 'sk-test', transport })
      .withSystemPrompt('You are terse.')
      .withPrompt('Hi')
      .asText();

    const messages = sent(calls).messages as { role: string }[];

    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('reads the finish reason off the CHOICE, not the root', async () => {
    // The chat-completions shape puts it there. Reading the root returns
    // undefined and every generation reports Unknown.
    const { transport } = transportFor({
      ...CHAT,
      choices: [{ index: 0, message: { content: 'x' }, finish_reason: 'content_filter' }],
    });

    const response = await Prism.text()
      .using('mistral', 'mistral-large-latest', { apiKey: 'sk-test', transport })
      .withPrompt('Hi')
      .asText();

    expect(response.finishReason).toBe(FinishReason.ContentFilter);
  });

  it('joins typed content chunks rather than stringifying the array', async () => {
    // Reasoning models return an array. `String(array)` is `[object Object]`,
    // which reads as a model that answered nonsense.
    const { transport } = transportFor({
      ...CHAT,
      choices: [
        {
          index: 0,
          message: {
            content: [
              { type: 'thinking', thinking: [{ type: 'text', text: 'hmm' }] },
              { type: 'text', text: 'the answer' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    });

    const response = await Prism.text()
      .using('mistral', 'magistral-medium-latest', { apiKey: 'sk-test', transport })
      .withPrompt('Hi')
      .asText();

    expect(response.text).toBe('the answer');
    expect(response.additionalContent.thinking).toBe('hmm');
  });

  it('omits an empty tool list rather than sending []', async () => {
    // An empty array is truthy in JavaScript, so a direct port sends
    // `"tools":[]` — which changes tool_choice defaults on some models.
    const { transport, calls } = transportFor(CHAT);

    await Prism.text().using('mistral', 'mistral-large-latest', { apiKey: 'sk-test', transport }).withPrompt('Hi').asText();

    expect(sent(calls)).not.toHaveProperty('tools');
    expect(sent(calls)).not.toHaveProperty('tool_choice');
  });

  it('maps tools into the nested chat-completions shape', async () => {
    const { transport, calls } = transportFor(CHAT);

    await Prism.text()
      .using('mistral', 'mistral-large-latest', { apiKey: 'sk-test', transport })
      .withPrompt('Weather?')
      .withTools([new Tool().as('weather').for('Look up weather').withStringParameter('city', 'The city')])
      .withToolChoice(ToolChoice.Any)
      .asText();

    const body = sent(calls);

    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'weather',
          description: 'Look up weather',
          parameters: { type: 'object', properties: { city: { description: 'The city', type: 'string' } }, required: ['city'] },
        },
      },
    ]);
    // A bare string, not OpenAI's `required` and not Anthropic's object.
    expect(body.tool_choice).toBe('any');
  });

  it('reads a bare `message` error, which is what a malformed request gets', async () => {
    const { transport } = transportFor({ object: 'error', message: 'Invalid model', type: 'invalid_request_error' }, 422);

    await expect(
      Prism.text().using('mistral', 'nope', { apiKey: 'sk-test', transport }).withPrompt('Hi').asText(),
    ).rejects.toThrowError(/Invalid model/);
  });
});

describe('fim', () => {
  const FIM = {
    id: 'fim-1',
    model: 'codestral-latest',
    choices: [{ index: 0, message: { content: '    return a + b' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 6 },
  };

  it('posts a prompt and a suffix to its own endpoint', async () => {
    const { transport, calls } = transportFor(FIM);

    const response = await Prism.fim()
      .using('mistral', 'codestral-latest', { apiKey: 'sk-test', transport })
      .withPrompt('def add(a, b):\n')
      .withSuffix('\n\nprint(add(1, 2))')
      .asText();

    // A DIFFERENT endpoint from chat, not a mode of it.
    expect(calls[0]?.url).toBe('https://api.mistral.ai/v1/fim/completions');
    expect(sent(calls)).toEqual({
      model: 'codestral-latest',
      prompt: 'def add(a, b):\n',
      suffix: '\n\nprint(add(1, 2))',
    });
    expect(response.text).toBe('    return a + b');
    expect(response.finishReason).toBe(FinishReason.Stop);
    expect(response.usage.completionTokens).toBe(6);
  });

  it('omits the suffix when none was set, because that is a different request', async () => {
    // No suffix means "complete to the end", not a degraded version of a
    // suffixed call.
    const { transport, calls } = transportFor(FIM);

    await Prism.fim().using('mistral', 'codestral-latest', { apiKey: 'sk-test', transport }).withPrompt('x').asText();

    expect(sent(calls)).not.toHaveProperty('suffix');
  });

  it('keeps a temperature of zero and drops an empty stop list', async () => {
    // 0 is a real setting; an empty array is truthy in JavaScript and would be
    // sent as `"stop":[]`, reading as a caller who chose no stop sequences.
    const { transport, calls } = transportFor(FIM);

    await Prism.fim()
      .using('mistral', 'codestral-latest', { apiKey: 'sk-test', transport })
      .withPrompt('x')
      .withTemperature(0)
      .asText();

    expect(sent(calls).temperature).toBe(0);
    expect(sent(calls)).not.toHaveProperty('stop');
  });

  it('wraps a single stop string, matching the reference', async () => {
    const { transport, calls } = transportFor(FIM);

    await Prism.fim()
      .using('mistral', 'codestral-latest', { apiKey: 'sk-test', transport })
      .withPrompt('x')
      .withStop('\n\n')
      .asText();

    expect(sent(calls).stop).toEqual(['\n\n']);
  });

  it('reports a length finish WITHOUT throwing', async () => {
    // Unlike a chat call. Hitting the ceiling is an ordinary outcome for a
    // completion: the caller wanted as much of the gap as the budget bought,
    // and the partial text is useful.
    const { transport } = transportFor({
      ...FIM,
      choices: [{ index: 0, message: { content: '    return a' }, finish_reason: 'length' }],
    });

    const response = await Prism.fim()
      .using('mistral', 'codestral-latest', { apiKey: 'sk-test', transport })
      .withPrompt('x')
      .withMaxTokens(4)
      .asText();

    expect(response.finishReason).toBe(FinishReason.Length);
    expect(response.text).toBe('    return a');
  });

  it('calls an unrecognised finish reason Unknown, not Stop', async () => {
    // A truncated completion reported as complete is how an editor silently
    // inserts half a function.
    const { transport } = transportFor({
      ...FIM,
      choices: [{ index: 0, message: { content: 'x' }, finish_reason: 'reticulating' }],
    });

    const response = await Prism.fim()
      .using('mistral', 'codestral-latest', { apiKey: 'sk-test', transport })
      .withPrompt('x')
      .asText();

    expect(response.finishReason).toBe(FinishReason.Unknown);
  });

  it('is refused by a provider that has no FIM endpoint', async () => {
    await expect(
      Prism.fim().using('openai', 'gpt-4o', { apiKey: 'sk-test' }).withPrompt('x').asText(),
    ).rejects.toThrowError(PrismError);
  });
});

describe('embeddings', () => {
  it('sends model and input only, and orders by the provider index', async () => {
    // Unknown keys are rejected outright by this endpoint rather than ignored,
    // so OpenAI's `dimensions`/`encoding_format` are not forwarded.
    const { transport, calls } = transportFor({
      id: 'emb-1',
      model: 'mistral-embed',
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
      usage: { total_tokens: 7 },
    });

    const response = await Prism.embeddings()
      .using('mistral', 'mistral-embed', { apiKey: 'sk-test', transport })
      .fromArray(['first', 'second'])
      .withProviderOptions({ dimensions: 512 })
      .asEmbeddings();

    expect(sent(calls)).toEqual({ model: 'mistral-embed', input: ['first', 'second'] });
    expect(response.embeddings[0]?.embedding).toEqual([0.1, 0.2]);
    expect(response.usage.tokens).toBe(7);
  });
});

describe('configuration', () => {
  it('reads the api key and url from the environment when unset', () => {
    const provider = new Mistral({});

    expect(provider.url).toBe('https://api.mistral.ai/v1');
    expect(provider.providerName).toBe('Mistral');
  });

  it('strips a trailing slash so paths do not double up', () => {
    expect(new Mistral({ url: 'https://gateway.test/v1/' }).url).toBe('https://gateway.test/v1');
  });

  it('omits the Authorization header entirely when no key is configured', () => {
    expect(new Mistral({ apiKey: '' }).headers()).not.toHaveProperty('Authorization');
  });
});

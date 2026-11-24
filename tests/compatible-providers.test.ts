import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureProviders, Prism, registeredProviders, resolveProvider } from '../src/index.js';
import type { CompatibleProviderEntry } from '../src/index.js';
import { clearOpenAIEnvironment, installFakeFetch, jsonReply, wire } from './support/fake-fetch.js';
import type { FakeFetch } from './support/fake-fetch.js';

/*
 * G-321 A: named OpenAI-compatible providers.
 *
 * Every case enters where an application does — configureProviders() and then
 * Prism.text().using(name, ...) — and inspects what reached fetch. The network
 * is blocked before the first request; a fixture key is never a real one.
 */

const OK = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: 'local-model',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 3, completion_tokens: 1 },
};

const ENV_KEY = 'sk-test-env-openai-key';
const ENTRY_KEY = 'sk-test-entry-key';

let counter = 0;
function unique(prefix = 'compat'): string {
  counter += 1;

  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function entry(overrides: Partial<CompatibleProviderEntry> = {}): CompatibleProviderEntry {
  return { driver: 'openai-compatible', url: 'https://llm.example.test/v1', ...overrides };
}

let fake: FakeFetch;

beforeEach(() => {
  clearOpenAIEnvironment();
  fake = installFakeFetch();
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function ask(name: string, config: Record<string, unknown> = {}): Promise<void> {
  await Prism.text().using(name, 'local-model', config).withPrompt('hi').asText();
}

describe('a compatible entry sends only its own credentials', () => {
  it('sends its own key, organization and project, and nothing from the environment', async () => {
    vi.stubEnv('OPENAI_API_KEY', ENV_KEY);
    vi.stubEnv('OPENAI_ORGANIZATION', 'org-test-env');
    vi.stubEnv('OPENAI_PROJECT', 'proj-test-env');
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY, organization: 'org-test-entry', project: 'proj-test-entry' }) });
    fake.reply(jsonReply(OK));

    await ask(name);

    expect(fake.sent).toHaveLength(1);
    const [request] = fake.sent;
    expect(request?.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(request?.headers.authorization).toBe(`Bearer ${ENTRY_KEY}`);
    expect(request?.headers['openai-organization']).toBe('org-test-entry');
    expect(request?.headers['openai-project']).toBe('proj-test-entry');
    expect(wire(fake.sent)).not.toContain(ENV_KEY);
    expect(wire(fake.sent)).not.toContain('org-test-env');
    expect(wire(fake.sent)).not.toContain('proj-test-env');
  });

  it('sends NO Authorization header when the entry has no key, whatever the environment holds', async () => {
    vi.stubEnv('OPENAI_API_KEY', ENV_KEY);
    vi.stubEnv('OPENAI_ORGANIZATION', 'org-test-env');
    vi.stubEnv('OPENAI_PROJECT', 'proj-test-env');
    vi.stubEnv('OPENAI_URL', 'https://llm.example.test/v1');
    vi.stubEnv('OPENAI_API_FORMAT', 'responses');
    const names = [unique(), unique(), unique()];
    configureProviders({
      [names[0] as string]: entry(),
      [names[1] as string]: entry({ apiKey: null, organization: null, project: null }),
      [names[2] as string]: entry({ apiKey: '', organization: '', project: '' }),
    });

    for (const name of names) {
      fake.reply(jsonReply(OK));
      await ask(name);
    }

    expect(fake.sent).toHaveLength(3);
    for (const request of fake.sent) {
      // The entry's url and format, not OPENAI_URL / OPENAI_API_FORMAT.
      expect(request.url).toBe('https://llm.example.test/v1/chat/completions');
      expect(request.headers).not.toHaveProperty('authorization');
      expect(request.headers).not.toHaveProperty('openai-organization');
      expect(request.headers).not.toHaveProperty('openai-project');
    }
    expect(wire(fake.sent)).not.toContain(ENV_KEY);
    expect(wire(fake.sent)).not.toContain('org-test-env');
  });

  it('is not refused because OPENAI_URL in the environment is padded', async () => {
    vi.stubEnv('OPENAI_URL', ' https://api.openai.com/v1');
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });
    fake.reply(jsonReply(OK));

    await ask(name);

    expect(fake.sent[0]?.headers.authorization).toBe(`Bearer ${ENTRY_KEY}`);
  });

  it('accepts a private address and sends only its own key there', async () => {
    vi.stubEnv('OPENAI_API_KEY', ENV_KEY);
    const name = unique();
    configureProviders({ [name]: entry({ url: 'http://10.0.0.5:8000/v1', apiKey: ENTRY_KEY }) });
    fake.reply(jsonReply(OK));

    await ask(name);

    expect(fake.sent[0]?.url).toBe('http://10.0.0.5:8000/v1/chat/completions');
    expect(fake.sent[0]?.headers.authorization).toBe(`Bearer ${ENTRY_KEY}`);
    expect(wire(fake.sent)).not.toContain(ENV_KEY);
  });

  it('accepts localhost', async () => {
    const name = unique();
    configureProviders({ [name]: entry({ url: 'http://localhost:1234/v1' }) });
    fake.reply(jsonReply(OK));

    await ask(name);

    expect(fake.sent[0]?.url).toBe('http://localhost:1234/v1/chat/completions');
  });
});

describe('a per-call url override', () => {
  it('drops the entry key, organization and project when it points elsewhere', async () => {
    vi.stubEnv('OPENAI_API_KEY', ENV_KEY);
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY, organization: 'org-test-entry', project: 'proj-test-entry' }) });
    fake.reply(jsonReply(OK));

    await ask(name, { url: 'https://elsewhere.example.test/v1' });

    expect(fake.sent[0]?.url).toBe('https://elsewhere.example.test/v1/chat/completions');
    expect(fake.sent[0]?.headers).not.toHaveProperty('authorization');
    expect(wire(fake.sent)).not.toContain(ENTRY_KEY);
    expect(wire(fake.sent)).not.toContain(ENV_KEY);
    expect(wire(fake.sent)).not.toContain('org-test-entry');
    expect(wire(fake.sent)).not.toContain('proj-test-entry');
  });

  it('uses a key the per-call config supplies', async () => {
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });
    fake.reply(jsonReply(OK));

    await ask(name, { url: 'https://elsewhere.example.test/v1', apiKey: 'sk-test-per-call' });

    expect(fake.sent[0]?.headers.authorization).toBe('Bearer sk-test-per-call');
    expect(wire(fake.sent)).not.toContain(ENTRY_KEY);
  });

  it('keeps the entry key when the override is the same endpoint', async () => {
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });
    fake.reply(jsonReply(OK));

    await ask(name, { url: 'HTTPS://LLM.example.test/v1/' });

    expect(fake.sent[0]?.headers.authorization).toBe(`Bearer ${ENTRY_KEY}`);
  });

  it.each([
    ['file:', 'file:///etc/passwd'],
    ['relative', 'v1/chat'],
    ['padded', ' https://elsewhere.example.test/v1'],
    ['ftp:', 'ftp://elsewhere.example.test/v1'],
  ])('is refused when it is %s, before any request', async (_label, url) => {
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });

    await expect(ask(name, { url })).rejects.toThrow('not a valid provider url');
    expect(fake.sent).toHaveLength(0);
  });
});

describe('provider names', () => {
  it.each(['openai', 'OpenAI', 'ANTHROPIC', 'Mistral'])('refuses %s, which collides with a built-in', (name) => {
    expect(() => configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) })).toThrow('already registered');
    expect(resolveProvider('openai', { apiKey: 'sk-test-x' }).constructor.name).toBe('OpenAI');
  });

  it('refuses a case variant of an earlier compatible entry', () => {
    const name = unique('Earlier');
    configureProviders({ [name]: entry() });
    expect(() => configureProviders({ [name.toLowerCase()]: entry() })).toThrow('already registered');
  });

  it('replaces an earlier compatible entry only when asked', async () => {
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: 'sk-test-first' }) });
    configureProviders({ [name]: entry({ apiKey: 'sk-test-second' }) }, { replace: true });
    fake.reply(jsonReply(OK));

    await ask(name);

    expect(fake.sent[0]?.headers.authorization).toBe('Bearer sk-test-second');
  });

  it.each([
    ['padded', ' my-vllm'],
    ['trailing space', 'my-vllm '],
    ['Cyrillic homoglyph', 'оpenai'],
    ['zero-width', 'open​ai'],
    ['empty', ''],
    ['slash', 'acme/edge'],
  ])('refuses a %s name and never trims it', (_label, name) => {
    expect(() => configureProviders({ [name]: entry() })).toThrow('not a valid provider name');
    expect(registeredProviders()).not.toContain(name);
    expect(registeredProviders()).not.toContain(name.trim());
  });

  it('accepts a mixed-case name that collides with nothing, under that exact name', async () => {
    const name = unique('My-VLLM');
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });
    fake.reply(jsonReply(OK));

    await ask(name);

    expect(registeredProviders()).toContain(name);
    expect(fake.sent[0]?.headers.authorization).toBe(`Bearer ${ENTRY_KEY}`);
  });
});

describe('entry validation is all-or-nothing', () => {
  it('registers nothing when any entry is invalid', () => {
    const good = unique();
    const bad = unique();
    expect(() => configureProviders({
      [good]: entry(),
      [bad]: entry({ url: 'file:///etc/passwd' }),
    })).toThrow('not a valid provider url');
    expect(registeredProviders()).not.toContain(good);
    expect(registeredProviders()).not.toContain(bad);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://llm.example.test/v1'],
    ['relative', '/v1'],
    ['no host', 'http://'],
    ['padded', 'https://llm.example.test/v1 '],
    ['backslashes', 'http:\\\\llm.example.test/v1'],
    ['not a string', 42],
  ])('refuses a %s url', (_label, url) => {
    const name = unique();
    expect(() => configureProviders({ [name]: { driver: 'openai-compatible', url } as unknown as CompatibleProviderEntry }))
      .toThrow('not a valid provider url');
    expect(registeredProviders()).not.toContain(name);
  });

  it.each(['openai', 'anthropic', 'OpenAI-Compatible', '', 'openai-compatible '])('refuses the driver "%s"', (driver) => {
    const name = unique();
    expect(() => configureProviders({ [name]: { ...entry(), driver } as unknown as CompatibleProviderEntry }))
      .toThrow('not a supported provider driver');
    expect(registeredProviders()).not.toContain(name);
  });

  it.each(['completions', 'Chat_Completions', '', 'messages'])('refuses the api format "%s"', (apiFormat) => {
    const name = unique();
    expect(() => configureProviders({ [name]: entry({ apiFormat }) })).toThrow('not a valid api format');
    expect(registeredProviders()).not.toContain(name);
  });

  it('defaults to chat_completions and accepts responses', async () => {
    const chat = unique();
    const responses = unique();
    configureProviders({ [chat]: entry(), [responses]: entry({ apiFormat: 'responses' }) });
    fake.reply(jsonReply(OK), jsonReply({
      id: 'resp_1', object: 'response', status: 'completed', model: 'local-model',
      output: [{ id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));

    await ask(chat);
    await ask(responses);

    expect(fake.sent.map((request) => request.url)).toEqual([
      'https://llm.example.test/v1/chat/completions',
      'https://llm.example.test/v1/responses',
    ]);
  });

  it('never puts the url or the key in a refusal message', () => {
    const secretUrl = 'file:///home/someone/sk-test-in-url';
    try {
      configureProviders({ [unique()]: entry({ url: secretUrl, apiKey: ENTRY_KEY }) });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('sk-test');
      expect(String((error as Error).message)).not.toContain('/home/someone');
    }
  });
});

describe('errors never carry the key', () => {
  it('an HTTP 500', async () => {
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });
    fake.reply(jsonReply({ error: { message: 'upstream exploded', type: 'server_error' } }, 500));

    const failure = await ask(name).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'provider_response_error', httpStatus: 500 });
    expect(String((failure as Error).message)).not.toContain(ENTRY_KEY);
    expect(JSON.stringify(failure)).not.toContain(ENTRY_KEY);
  });

  it('a transport that throws', async () => {
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });
    fake.reply(new Error('connect ECONNREFUSED'));

    const failure = await ask(name).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).not.toContain(ENTRY_KEY);
  });

  it('a streamed HTTP 500', async () => {
    const name = unique();
    configureProviders({ [name]: entry({ apiKey: ENTRY_KEY }) });
    fake.reply(jsonReply({ error: { message: 'upstream exploded' } }, 500));

    const failure = await (async () => {
      for await (const _event of Prism.text().using(name, 'local-model').withPrompt('hi').asStream()) { /* drain */ }
    })().catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'provider_response_error', httpStatus: 500 });
    expect(String((failure as Error).message)).not.toContain(ENTRY_KEY);
  });
});

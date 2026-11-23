import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prism, registerProvider, registeredProviders, resolveProvider } from '../src/index.js';
import type { Provider } from '../src/index.js';

/**
 * A credential from the environment is scoped to the endpoint the environment
 * configures (or the provider default). A per-call config that points the
 * provider elsewhere must bring its own key; the environment one is never sent.
 *
 * Every case enters where an application does — Prism.text().using(name,
 * model, config) — and inspects what actually reached fetch.
 */

const providers = [
  { name: 'openai', keyEnv: 'OPENAI_API_KEY', urlEnv: 'OPENAI_URL', defaultUrl: 'https://api.openai.com/v1' },
  { name: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', urlEnv: 'ANTHROPIC_URL', defaultUrl: 'https://api.anthropic.com/v1' },
  { name: 'mistral', keyEnv: 'MISTRAL_API_KEY', urlEnv: 'MISTRAL_URL', defaultUrl: 'https://api.mistral.ai/v1' },
] as const;

const environmentNames = [
  'OPENAI_API_KEY', 'OPENAI_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_URL', 'MISTRAL_API_KEY', 'MISTRAL_URL',
];

interface Sent { url: string; wire: string }

async function send(name: string, config: Record<string, unknown>): Promise<Sent[]> {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const flat = [...headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n');
    sent.push({ url: String(url), wire: `${String(url)}\n${flat}\n${typeof init?.body === 'string' ? init.body : ''}` });
    return new Response(JSON.stringify({ error: { message: 'fixture' } }), { status: 500, headers: { 'content-type': 'application/json' } });
  }));

  try {
    await Prism.text().using(name, 'fixture-model', config).withPrompt('hi').asText();
  } catch {
    // The response is a fixture failure; only the outgoing request matters.
  }

  return sent;
}

function withEnvironment(entries: Record<string, string>): void {
  for (const name of environmentNames) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(entries)) vi.stubEnv(name, value);
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe.each(providers)('$name credential scope', ({ name, keyEnv, urlEnv, defaultUrl }) => {
  const secret = `env-secret-${name}`;

  it('does not send the environment key to a per-call URL that brings no key', async () => {
    withEnvironment({ [keyEnv]: secret });
    const sent = await send(name, { url: 'https://other-host.example/v1' });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) {
      expect(request.url).toContain('other-host.example');
      expect(request.wire).not.toContain(secret);
    }
  });

  it('sends the key supplied alongside a per-call URL', async () => {
    withEnvironment({ [keyEnv]: secret });
    const sent = await send(name, { url: 'https://other-host.example/v1', apiKey: `explicit-key-${name}` });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) {
      expect(request.wire).toContain(`explicit-key-${name}`);
      expect(request.wire).not.toContain(secret);
    }
  });

  it('keeps the environment key when the per-call URL is the default', async () => {
    withEnvironment({ [keyEnv]: secret });
    const sent = await send(name, { url: defaultUrl });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) expect(request.wire).toContain(secret);
  });

  it('keeps the environment key when no URL is passed', async () => {
    withEnvironment({ [keyEnv]: secret });
    const sent = await send(name, {});
    expect(sent).not.toHaveLength(0);
    for (const request of sent) expect(request.wire).toContain(secret);
  });

  it('keeps the environment key when the per-call URL is the environment-configured one', async () => {
    withEnvironment({ [keyEnv]: secret, [urlEnv]: 'https://gateway.example/v1' });
    const sent = await send(name, { url: 'https://gateway.example/v1' });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) expect(request.wire).toContain(secret);
  });

  it('keeps the environment key when the per-call URL differs only trivially', async () => {
    withEnvironment({ [keyEnv]: secret });
    const variant = `${defaultUrl.replace(/^https:\/\/[^/]+/, (origin) => origin.toUpperCase())}/`;
    const sent = await send(name, { url: variant });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) expect(request.wire).toContain(secret);
  });

  it('treats a different port on the same host as a different endpoint', async () => {
    withEnvironment({ [keyEnv]: secret });
    const sent = await send(name, { url: defaultUrl.replace(/^(https:\/\/[^/]+)/, '$1:8443') });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) expect(request.wire).not.toContain(secret);
  });

  it('does not send the environment key to the default when the environment URL is elsewhere', async () => {
    // The environment key belongs to the environment URL, not to the default.
    withEnvironment({ [keyEnv]: secret, [urlEnv]: 'https://gateway.example/v1' });
    const sent = await send(name, { url: 'https://other-host.example/v1' });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) expect(request.wire).not.toContain(secret);
  });
});

describe('openai account identifiers', () => {
  it('are not sent from the environment to a per-call URL', async () => {
    withEnvironment({ OPENAI_API_KEY: 'env-secret-openai', OPENAI_ORGANIZATION: 'env-org-id', OPENAI_PROJECT: 'env-project-id' });
    const sent = await send('openai', { url: 'https://other-host.example/v1' });
    expect(sent).not.toHaveLength(0);
    for (const request of sent) {
      expect(request.wire).not.toContain('env-org-id');
      expect(request.wire).not.toContain('env-project-id');
    }
  });
});

describe('provider registration', () => {
  const stub = (): Provider => ({}) as Provider;

  it.each(['openai', 'anthropic', 'mistral'])('refuses to replace the built-in %s', (name) => {
    const before = resolveProvider(name, { apiKey: 'x' });
    expect(() => registerProvider(name, stub)).toThrow();
    expect(resolveProvider(name, { apiKey: 'x' }).constructor).toBe(before.constructor);
  });

  it('refuses to silently replace an already-registered provider', () => {
    registerProvider('credential-scope-once', stub);
    expect(() => registerProvider('credential-scope-once', stub)).toThrow();
  });

  it('replaces a provider when replacement is explicit', () => {
    const replacement = { marker: 'replacement' } as unknown as Provider;
    registerProvider('credential-scope-twice', stub);
    registerProvider('credential-scope-twice', () => replacement, { replace: true });
    expect(resolveProvider('credential-scope-twice')).toBe(replacement);
    expect(registeredProviders()).toContain('credential-scope-twice');
  });

  // Case-insensitive (ASCII), as the reference's strtolower() and prism-py are.
  it.each(['OpenAI', 'ANTHROPIC', 'Mistral'])('refuses %s, a case variant of a built-in', (name) => {
    expect(() => registerProvider(name, stub)).toThrow('already registered');
    expect(registeredProviders()).not.toContain(name);
  });

  it('refuses a case variant of a custom provider registered earlier', () => {
    registerProvider('credential-scope-case', stub);
    expect(() => registerProvider('Credential-Scope-Case', stub)).toThrow('already registered');
    expect(registeredProviders()).not.toContain('Credential-Scope-Case');
  });

  /*
   * A provider name is a positive ASCII allow-list,
   * ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$, spelled identically in the reference
   * and prism-py. It replaces a forbidden-character test that relied on each
   * language's Unicode tables. Look-alikes, padding and invisible codepoints
   * are refused, never trimmed or folded.
   */
  it.each([
    ['empty', ''],
    ['leading space', ' openai'],
    ['trailing space', 'openai '],
    ['interior space', 'open ai'],
    ['tab', 'openai\t'],
    ['newline', 'openai\n'],
    ['NUL', 'openai\u0000'],
    ['C0 control', 'openai\u001F'],
    ['NEL', 'openai\u0085'],
    ['no-break space', 'openai\u00A0'],
    ['ideographic space', 'open\u3000ai'],
    ['zero-width space', 'openai\u200B'],
    ['zero-width joiner', 'open\u200Dai'],
    ['BOM prefix', '\uFEFFopenai'],
    ['right-to-left override (Cf)', 'openai\u202E'],
    ['word joiner (Cf, outside G-36)', 'openai\u2060'],
    ['soft hyphen (Cf)', 'open\u00ADai'],
    ['lone surrogate', 'openai\uD800'],
    ['Cyrillic o homoglyph', '\u043Epenai'],
    ['Cyrillic a homoglyph', 'open\u0430i'],
    ['full-width', '\uFF4F\uFF50\uFF45\uFF4E\uFF41\uFF49'],
    ['Latin-1 letter', 'caf\u00E9'],
    ['leading hyphen', '-openai'],
    ['leading dot', '.openai'],
    ['leading underscore', '_openai'],
    ['colon', 'acme:edge'],
    ['slash', 'acme/edge'],
    ['65 characters', 'a'.repeat(65)],
  ])('refuses a provider name with %s', (_label, name) => {
    expect(() => registerProvider(name, stub)).toThrow('not a valid provider name');
    // Refused even when replacement is explicit: replace does not license a name.
    expect(() => registerProvider(name, stub, { replace: true })).toThrow('not a valid provider name');
    expect(registeredProviders()).not.toContain(name);
  });

  it.each(['credential-scope-plain', 'my_provider.v2', '0day', 'q', 'b'.repeat(64)])(
    'still accepts the ordinary custom provider name %s',
    (name) => {
      const marker = { marker: name } as unknown as Provider;
      registerProvider(name, () => marker);
      expect(resolveProvider(name)).toBe(marker);
    },
  );

  // A built-in name passes the allow-list: it reaches the collision check.
  it.each(['anthropic', 'mistral', 'openai'])('treats the built-in name %s as a valid name', (name) => {
    expect(() => registerProvider(name, stub)).toThrow('already registered');
  });
});

/*
 * A url carrying whitespace or a control character anywhere is refused before
 * any request, whether it is passed per call or configured in the environment.
 * The forbidden set is spelled by codepoint, identically in the reference and
 * prism-py: every Cc control (U+0000..U+001F, U+007F..U+009F), every Unicode
 * White_Space codepoint, and the G-36 zero-widths U+200B..U+200D and U+FEFF.
 * The error names neither the url nor the key.
 */
const dirtyUrls: Array<[string, string]> = [
  ['padded both ends (cs-0016)', ' https://api.openai.com/v1 '],
  ['leading space', ' https://api.openai.com/v1'],
  ['trailing space', 'https://api.openai.com/v1 '],
  ['interior space', 'https://api.openai.com/v1 x'],
  ['tab', 'https://api.openai.com/v1\t'],
  ['newline', 'https://api.openai.com/v1\n'],
  ['carriage return', '\rhttps://api.openai.com/v1'],
  ['NUL', 'https://api.openai.com\u0000/v1'],
  ['DEL', 'https://api.openai.com/v1\u007F'],
  ['C1 control', 'https://api.openai.com/v1\u009B'],
  ['NEL', 'https://api.openai.com/v1\u0085'],
  ['no-break space', '\u00A0https://api.openai.com/v1'],
  ['ideographic space', 'https://api.openai.com/v1\u3000'],
  ['zero-width space', 'https://api.openai.com\u200B/v1'],
  ['BOM prefix', '\uFEFFhttps://api.openai.com/v1'],
];

async function attempt(name: string, config: Record<string, unknown>): Promise<{ sent: number; error: unknown }> {
  let sent = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    sent += 1;
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  }));
  let error: unknown = null;
  try {
    await Prism.text().using(name, 'fixture-model', config).withPrompt('hi').asText();
  } catch (caught) {
    error = caught;
  }
  return { sent, error };
}

describe.each(providers)('$name url hygiene', ({ name, keyEnv, urlEnv }) => {
  it.each(dirtyUrls)('refuses a per-call url with %s before any request', async (_label, url) => {
    withEnvironment({ [keyEnv]: `env-secret-${name}` });
    const { sent, error } = await attempt(name, { url });
    expect(sent).toBe(0);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('url must not contain whitespace or control characters');
    expect(message).not.toContain('openai.com');
    expect(message).not.toContain(`env-secret-${name}`);
  });

  it('refuses an environment url with a trailing newline before any request', async () => {
    withEnvironment({ [keyEnv]: `env-secret-${name}`, [urlEnv]: 'https://gateway.example/v1\n' });
    const { sent, error } = await attempt(name, {});
    expect(sent).toBe(0);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('url must not contain whitespace or control characters');
    expect((error as Error).message).not.toContain('gateway.example');
  });
});

describe('custom provider url hygiene', () => {
  it('refuses a padded url before the factory runs', () => {
    let called = false;
    registerProvider('credential-scope-padded', () => { called = true; return {} as Provider; });
    expect(() => resolveProvider('credential-scope-padded', { url: ' https://configured.example/v1' }))
      .toThrow('url must not contain whitespace or control characters');
    expect(called).toBe(false);
  });
});

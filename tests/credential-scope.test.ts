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
});

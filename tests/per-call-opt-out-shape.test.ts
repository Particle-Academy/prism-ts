import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureProviders, Prism, PrismError, registerProvider } from '../src/index.js';
import type { Provider } from '../src/index.js';
import { installFakeFetch, jsonReply } from './support/fake-fetch.js';
import type { FakeFetch } from './support/fake-fetch.js';

/*
 * G-382. The per-call opt-out (`OPENAI_ALLOW_PRIVATE_PER_CALL_URL`,
 * `allowPrivatePerCallUrl` on a registration or a compatible entry) lets a
 * per-call url name a private ADDRESS. It does not let it name another
 * scheme, or a host the guard cannot read the way the client will: those
 * rules hold with the opt-out on, as in the reference and prism-py.
 *
 * Every case enters through Prism.text().using(), with a fetch that records
 * and refuses anything unqueued. A custom provider's factory gets the url as
 * given and brings its own client, so it must never run.
 */

const ENVIRONMENT = ['OPENAI_API_KEY', 'OPENAI_URL', 'OPENAI_ALLOW_PRIVATE_PER_CALL_URL'];

let fake: FakeFetch;

beforeEach(() => {
  for (const name of ENVIRONMENT) vi.stubEnv(name, undefined);
  fake = installFakeFetch();
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

let counter = 0;
function unique(prefix: string): string {
  counter += 1;

  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

async function ask(name: string, config: Record<string, unknown> = {}): Promise<unknown> {
  try {
    await Prism.text().using(name, 'fixture-model', config).withPrompt('hi').asText();
  } catch (error) {
    return error;
  }

  return undefined;
}

const SHAPES: ReadonlyArray<readonly [string, string, string]> = [
  ['file scheme', 'file:///etc/passwd', 'scheme_not_allowed'],
  ['file scheme, upper case', 'FILE:///etc/passwd', 'scheme_not_allowed'],
  ['data scheme', 'data:text/plain,hello', 'scheme_not_allowed'],
  ['blob scheme', 'blob:nodedata:00000000-0000-0000-0000-000000000000', 'scheme_not_allowed'],
  ['ftp scheme', 'ftp://10.0.0.5/v1', 'scheme_not_allowed'],
  ['wrapped url with userinfo', '<URL:http://user:pass@10.0.0.5/v1>', 'scheme_not_allowed'],
  ['URL: prefix', 'URL:http://10.0.0.5/v1', 'scheme_not_allowed'],
  ['backslash authority', 'http:\\\\10.0.0.5\\v1', 'scheme_not_allowed'],
  ['backslash before the at sign', 'http://10.0.0.5\\@public.example/v1', 'private_address_refused'],
  ['percent-escaped address', 'http://%31%30.0.0.5/v1', 'private_address_refused'],
  ['percent-escaped name', 'http://loc%61lhost/v1', 'private_address_refused'],
  ['full-width digits', 'http://１０.0.0.5/v1', 'non_ascii_host_use_punycode'],
  ['non-ascii host', 'http://exämple.test/v1', 'non_ascii_host_use_punycode'],
  ['zone id', 'http://[fe80::1%25eth0]/v1', 'private_address_refused'],
];

function expectRefusedBeforeDispatch(error: unknown, code: string, url: string): void {
  expect(error).toBeInstanceOf(PrismError);
  expect((error as PrismError).code).toBe(code);
  expect((error as PrismError).message).not.toContain(url);
  expect(fake.sent).toHaveLength(0);
}

describe('the per-call opt-out on a built-in provider', () => {
  it.each(SHAPES)('still refuses a %s', async (_label, url, code) => {
    vi.stubEnv('OPENAI_ALLOW_PRIVATE_PER_CALL_URL', 'true');
    expectRefusedBeforeDispatch(await ask('openai', { url, apiKey: 'sk-test' }), code, url);
  });

  it.each([
    'http://127.0.0.1:9/v1',
    'http://LOCALHOST.:9/v1',
    'http://[::1]:9/v1',
    'http://[fd00::1]/v1',
    'http://169.254.169.254/v1',
    'http://10.0.0.5/v1',
  ])('still dispatches the private address %s', async (url) => {
    vi.stubEnv('OPENAI_ALLOW_PRIVATE_PER_CALL_URL', 'true');
    fake.reply(jsonReply({ error: { message: 'fixture' } }, 500));
    await ask('openai', { url, apiKey: 'sk-test' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.toLowerCase().startsWith(url.toLowerCase().replace(/\/v1$/, ''))).toBe(true);
  });
});

describe('the per-call opt-out on a compatible entry', () => {
  it.each(SHAPES)('still refuses a %s', async (_label, url, code) => {
    const name = unique('compat');
    configureProviders({ [name]: { driver: 'openai-compatible', url: 'https://llm.example.test/v1', allowPrivatePerCallUrl: true } });
    const error = await ask(name, { url });
    // An entry already refused a url that is not absolute http(s) with its
    // own "not a valid provider url" TypeError, before the guard runs.
    if (code === 'scheme_not_allowed' && error instanceof TypeError) {
      expect(error.message).toContain('not a valid provider url');
      expect(fake.sent).toHaveLength(0);
      return;
    }
    expectRefusedBeforeDispatch(error, code, url);
  });
});

describe('the per-call opt-out on a registered provider', () => {
  it.each(SHAPES)('still refuses a %s before the factory runs', async (_label, url, code) => {
    const name = unique('custom');
    const received: unknown[] = [];
    registerProvider(name, (config) => {
      received.push(config.url);

      return {} as Provider;
    }, { allowPrivatePerCallUrl: true });
    expectRefusedBeforeDispatch(await ask(name, { url }), code, url);
    expect(received).toEqual([]);
  });
});

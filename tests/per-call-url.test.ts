import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureProviders, Prism, PrismError, registerProvider } from '../src/index.js';
import type { Provider } from '../src/index.js';
import { installFakeFetch, jsonReply } from './support/fake-fetch.js';
import type { FakeFetch } from './support/fake-fetch.js';

/*
 * A per-call provider url may not choose a loopback, private, link-local or
 * metadata address (Wish, 2026-11-24: "users shouldn't be choosing the address
 * for a single call"). Configuration may point anywhere.
 *
 * Every case enters where an application does — Prism.text().using(name,
 * model, config) — with a fetch that records and refuses anything unqueued,
 * and asserts the error code, that nothing was sent, and that the message
 * names no part of the address.
 */

const PRIVATE_MESSAGE =
  'A per-call provider url may not point at a loopback, private, link-local or metadata address. Allow it in the provider config with allowPrivatePerCallUrl.';
const SCHEME_MESSAGE = 'A per-call provider url must be an absolute http or https url.';

const ENVIRONMENT = [
  'OPENAI_API_KEY', 'OPENAI_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT', 'OPENAI_API_FORMAT', 'OPENAI_ALLOW_PRIVATE_PER_CALL_URL',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_URL', 'ANTHROPIC_ALLOW_PRIVATE_PER_CALL_URL',
  'MISTRAL_API_KEY', 'MISTRAL_URL', 'MISTRAL_ALLOW_PRIVATE_PER_CALL_URL',
];

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

/** Send one text request; the error it raised, if any. */
async function ask(name: string, config: Record<string, unknown> = {}): Promise<unknown> {
  try {
    await Prism.text().using(name, 'fixture-model', config).withPrompt('hi').asText();
  } catch (error) {
    return error;
  }

  return undefined;
}

/** The host as written in the url: after any userinfo, before any port or path. */
function writtenHost(url: string): string {
  const authority = url.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
  const host = authority.slice(authority.lastIndexOf('@') + 1);

  return host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0] ?? host;
}

function expectRefused(error: unknown, code: string, url: string): void {
  expect(error).toBeInstanceOf(PrismError);
  const refusal = error as PrismError;
  expect(refusal.code).toBe(code);
  expect(refusal.message).toBe(code === 'scheme_not_allowed' ? SCHEME_MESSAGE : PRIVATE_MESSAGE);
  expect(refusal.message).not.toContain(url);
  expect(refusal.message.toLowerCase()).not.toContain(writtenHost(url).toLowerCase());
  expect(fake.sent).toHaveLength(0);
}

/** A reply the provider will reject; only that the request went out matters. */
function replyOnce(): void {
  fake.reply(jsonReply({ error: { message: 'fixture' } }, 500));
}

const REFUSED = [
  'http://127.0.0.1:8000/v1',
  'HTTP://LocalHost:8000/v1',
  'http://localhost./v1',
  'http://2130706433/v1',
  'http://0177.0.0.1/v1',
  'http://0x7f000001/v1',
  'http://0x7f.1/v1',
  'http://127.1/v1',
  'http://[::1]/v1',
  'http://[::ffff:127.0.0.1]/v1',
  'http://[fd00::1]/v1',
  'http://[fe80::1]/v1',
  'http://169.254.169.254/latest',
  'http://metadata.google.internal/computeMetadata/v1',
  'http://METADATA.GOOGLE.INTERNAL./x',
  'http://0.0.0.0/v1',
  'http://10.0.0.5/v1',
  'http://172.16.0.1/v1',
  'http://192.168.1.10/v1',
  'http://100.100.100.200/x',
  'http://evil@127.0.0.1/v1',
  'http://user:pass@10.0.0.5/v1',
  'http://[64:ff9b::a9fe:a9fe]/',
];

const HOST_MESSAGE =
  'A per-call provider url host may hold only letters, digits, hyphens and dots, or an IPv6 address in brackets.';

/*
 * A host is judged as written. Some HTTP clients percent-decode a host before
 * they connect, so the guard never decodes: an escape, or any character a
 * hostname or address literal may not hold, is refused, and so is a backslash
 * in the authority, which URL parsers split in different places. WHATWG URL
 * decodes the host, so these are checked against the text, not `hostname`.
 */
const ESCAPED_OR_ILLEGAL: ReadonlyArray<readonly [string, string]> = [
  ['http://loc%61lhost:8080/admin', 'loc%61lhost'],
  ['http://LOC%41LHOST/v1', 'loc%41lhost'],
  ['http://localhost%2e/v1', 'localhost%2e'],
  ['http://127.0.0.1%2e/v1', '127.0.0.1'],
  ['http://127.0.0.1%00.evil.com/v1', '%00'],
  ['http://%31%32%37.0.0.1/v1', '%31'],
  ['http://169.254.169.254%2e/latest/meta-data/', '169.254'],
  ['http://metadata.google.internal%2e/x', 'metadata.google'],
  ['https://gateway%2eexample/v1', 'gateway'],
  ['https://gate_way.example/v1', 'gate_way'],
  ['http://127.0.0.1\\@gateway.example/v1', '127.0.0.1'],
  ['http://gateway.example\\@127.0.0.1/v1', 'gateway.example'],
  ['http://[fe80::1%25eth0]/v1', 'eth0'],
  ['http://[::%31]/v1', '%31'],
];

describe('a per-call host with an escape or a character no host may hold', () => {
  it.each(ESCAPED_OR_ILLEGAL)('refuses %s before any request', async (url, fragment) => {
    const error = await ask('openai', { url });
    expect(error).toBeInstanceOf(PrismError);
    expect((error as PrismError).code).toBe('private_address_refused');
    expect((error as PrismError).message.toLowerCase()).not.toContain(fragment.toLowerCase());
    expect(fake.sent).toHaveLength(0);
  });

  it.each(['http://127.0.0.1./v1', 'http://0x7f000001./v1', 'http://localhost../v1', 'http://169.254.169.254./latest'])(
    'reads the trailing dot in %s as the host the client contacts',
    async (url) => {
      expectRefused(await ask('openai', { url }), 'private_address_refused', url);
    },
  );

  it.each([
    'https://gateway.example./v1',
    'https://xn--bcher-kva.example/v1',
    'https://xn--strae-oqa.de/v1',
    'https://xn--mgbn2ecje63gr19l.ir/v1',
    'https://xn--mgbh0fb.3com.example/v1',
    'https://xn--bcher-kva.ab--cd.example/v1',
  ])('dispatches to the public host %s', async (url) => {
    replyOnce();
    await ask('openai', { url });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith(url)).toBe(true);
  });

  it('refuses an empty host as a scheme error rather than reading past it', async () => {
    const error = await ask('openai', { url: 'http:///127.0.0.1/v1' });
    expect(error).toBeInstanceOf(PrismError);
    expect((error as PrismError).code).toBe('scheme_not_allowed');
    expect((error as PrismError).message).toBe(SCHEME_MESSAGE);
    expect(fake.sent).toHaveLength(0);
  });

  it('names the host rule in the message', async () => {
    const error = await ask('openai', { url: 'https://gateway%2eexample/v1' });
    expect((error as PrismError).message).toBe(HOST_MESSAGE);
  });
});

describe('a per-call url on a built-in provider', () => {
  it.each(REFUSED)('refuses %s before any request', async (url) => {
    expectRefused(await ask('openai', { url }), 'private_address_refused', url);
  });

  it('refuses a non-http scheme', async () => {
    const url = 'ftp://example.com/v1';
    expectRefused(await ask('openai', { url }), 'scheme_not_allowed', url);
  });

  it('dispatches to a public per-call url', async () => {
    replyOnce();
    await ask('openai', { url: 'https://gateway.example/v1' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith('https://gateway.example/v1/')).toBe(true);
  });

  it('dispatches to a CONFIGURED private url when the call names none', async () => {
    vi.stubEnv('OPENAI_URL', 'http://127.0.0.1:1234/v1');
    replyOnce();
    await ask('openai');
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith('http://127.0.0.1:1234/v1/')).toBe(true);
  });

  it('dispatches when the per-call url is the configured endpoint', async () => {
    vi.stubEnv('OPENAI_URL', 'http://127.0.0.1:1234/v1');
    replyOnce();
    await ask('openai', { url: 'http://127.0.0.1:1234/v1/' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith('http://127.0.0.1:1234/v1/')).toBe(true);
  });

  it('still refuses a different private address when another is configured', async () => {
    vi.stubEnv('OPENAI_URL', 'http://127.0.0.1:1234/v1');
    const url = 'http://127.0.0.1:1235/v1';
    expectRefused(await ask('openai', { url }), 'private_address_refused', url);
  });

  it.each(['true', 'TRUE', '(true)'])('dispatches when the environment opt-out reads %s', async (value) => {
    vi.stubEnv('OPENAI_ALLOW_PRIVATE_PER_CALL_URL', value);
    replyOnce();
    await ask('openai', { url: 'http://127.0.0.1:9/v1' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith('http://127.0.0.1:9/v1/')).toBe(true);
  });

  it.each(['1', 'yes', 'false', ''])('keeps refusing when the environment opt-out reads %j', async (value) => {
    vi.stubEnv('OPENAI_ALLOW_PRIVATE_PER_CALL_URL', value);
    const url = 'http://127.0.0.1:9/v1';
    expectRefused(await ask('openai', { url }), 'private_address_refused', url);
  });

  it('ignores an opt-out passed with the call', async () => {
    const url = 'http://127.0.0.1:9/v1';
    expectRefused(await ask('openai', { url, allowPrivatePerCallUrl: true }), 'private_address_refused', url);
  });

  it('does not take one provider\'s opt-out for another', async () => {
    vi.stubEnv('ANTHROPIC_ALLOW_PRIVATE_PER_CALL_URL', 'true');
    const url = 'http://127.0.0.1:9/v1';
    expectRefused(await ask('openai', { url }), 'private_address_refused', url);
  });
});

describe.each([
  { name: 'anthropic', optOut: 'ANTHROPIC_ALLOW_PRIVATE_PER_CALL_URL' },
  { name: 'mistral', optOut: 'MISTRAL_ALLOW_PRIVATE_PER_CALL_URL' },
])('a per-call url on $name', ({ name, optOut }) => {
  it('is refused when private', async () => {
    const url = 'http://169.254.169.254/latest';
    expectRefused(await ask(name, { url }), 'private_address_refused', url);
  });

  it('dispatches when the provider\'s own opt-out is on', async () => {
    vi.stubEnv(optOut, 'true');
    replyOnce();
    await ask(name, { url: 'http://127.0.0.1:9/v1' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith('http://127.0.0.1:9/v1/')).toBe(true);
  });
});

describe('a per-call url on a compatible entry', () => {
  it('dispatches to an entry configured at 127.0.0.1 when the call names no url', async () => {
    const name = unique('compat');
    configureProviders({ [name]: { driver: 'openai-compatible', url: 'http://127.0.0.1:1234/v1' } });
    replyOnce();
    await ask(name);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith('http://127.0.0.1:1234/v1/')).toBe(true);
  });

  it('dispatches when the per-call url is the entry url', async () => {
    const name = unique('compat');
    configureProviders({ [name]: { driver: 'openai-compatible', url: 'http://127.0.0.1:1234/v1' } });
    replyOnce();
    await ask(name, { url: 'HTTP://127.0.0.1:1234/v1/' });
    expect(fake.sent).toHaveLength(1);
  });

  it('refuses a private per-call url', async () => {
    const name = unique('compat');
    configureProviders({ [name]: { driver: 'openai-compatible', url: 'https://llm.example.test/v1' } });
    const url = 'http://10.0.0.5:8000/v1';
    expectRefused(await ask(name, { url }), 'private_address_refused', url);
  });

  it('dispatches a private per-call url when the entry opts out', async () => {
    const name = unique('compat');
    configureProviders({
      [name]: { driver: 'openai-compatible', url: 'https://llm.example.test/v1', allowPrivatePerCallUrl: true },
    });
    replyOnce();
    await ask(name, { url: 'http://10.0.0.5:8000/v1' });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.url.startsWith('http://10.0.0.5:8000/v1/')).toBe(true);
  });

  it('ignores an opt-out passed with the call', async () => {
    const name = unique('compat');
    configureProviders({ [name]: { driver: 'openai-compatible', url: 'https://llm.example.test/v1' } });
    const url = 'http://10.0.0.5:8000/v1';
    expectRefused(await ask(name, { url, allowPrivatePerCallUrl: true }), 'private_address_refused', url);
  });

  it('refuses a non-boolean opt-out in the entry', () => {
    expect(() => configureProviders({
      [unique('compat')]: { driver: 'openai-compatible', url: 'https://llm.example.test/v1', allowPrivatePerCallUrl: 'true' as unknown as boolean },
    })).toThrow(TypeError);
  });
});

describe('a per-call url on a custom registered provider', () => {
  function fixtureProvider(): Provider {
    return { text: () => Promise.reject(new Error('fixture provider')) } as unknown as Provider;
  }

  it('is refused before the factory runs', async () => {
    const factory = vi.fn(fixtureProvider);
    const name = unique('custom');
    registerProvider(name, factory);
    const url = 'http://192.168.1.10/v1';
    expectRefused(await ask(name, { url }), 'private_address_refused', url);
    expect(factory).not.toHaveBeenCalled();
  });

  it('reaches the factory when registered with the opt-out', async () => {
    const factory = vi.fn(fixtureProvider);
    const name = unique('custom');
    registerProvider(name, factory, { allowPrivatePerCallUrl: true });
    await ask(name, { url: 'http://192.168.1.10/v1' });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('reaches the factory for a public per-call url', async () => {
    const factory = vi.fn(fixtureProvider);
    const name = unique('custom');
    registerProvider(name, factory);
    await ask(name, { url: 'https://gateway.example/v1' });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('a per-call url naming a hosts-file name or an IPv4-carrying IPv6 form', () => {
  it.each([
    'http://localhost4:8080/v1', 'http://localhost4.localdomain4/v1', 'http://localhost6:8080/v1',
    'http://LOCALHOST6.LOCALDOMAIN6./v1', 'http://ipv6-localhost/v1', 'http://broadcasthost/v1',
    'http://box.localhost.localdomain/v1', 'http://[::ffff:0:127.0.0.1]/v1', 'http://[::ffff:0:a9fe:a9fe]/v1',
    'http://[2001:4860::5efe:7f00:1]/v1',
  ])('refuses %s before any request', async (url) => {
    expectRefused(await ask('openai', { url }), 'private_address_refused', url);
  });
});

describe('a per-call host with a format, invisible or deviation character', () => {
  it.each([
    'http://loca\u00ADlhost/v1', 'http://169.254.169.254\u2060/latest', 'http://loca\u1806lhost/v1',
    'http://localhost\uFE0F/v1', 'https://fa\u00DF.example/v1', 'https://\u03BB\u03BF\u03B3\u03BF\u03C2.example/v1',
  ])('refuses %s with the host rule before any request', async (url) => {
    const error = await ask('openai', { url });
    expect(error).toBeInstanceOf(PrismError);
    expect((error as PrismError).code).toBe('private_address_refused');
    expect((error as PrismError).message).toBe(HOST_MESSAGE);
    expect(fake.sent).toHaveLength(0);
  });

  it.each(['http://loca\u200Dlhost/v1', 'http://127.0.0.1\u200D/v1', 'http://127.0.0.1\u200C/v1'])(
    'refuses the zero-width joiner in %s before any request',
    async (url) => {
      expect(await ask('openai', { url })).toBeInstanceOf(Error);
      expect(fake.sent).toHaveLength(0);
    },
  );
});

const PUNYCODE_MESSAGE = 'A per-call provider url host must be ASCII. Give an international name in its punycode (xn--) form.';

/*
 * A per-call host is ASCII. IDNA converters disagree on which name some
 * characters spell, so an international name is given in its punycode form,
 * which every client sends unchanged. The unicode spelling is refused with its
 * own code, in all three languages, whatever the name.
 */
describe('a non-ASCII per-call host', () => {
  it.each([
    ['https://b\u00FCcher.example/v1', 'b\u00FCcher'],
    ['https://\u043F\u0440\u0438\u043C\u0435\u0440.\u0440\u0444/v1', '\u0440\u0444'],
    ['https://\u0645\u062B\u0627\u0644.3com.example/v1', '3com'],
    ['https://b\u00FCcher.ab--cd.example/v1', 'ab--cd'],
    ['http://\uFF11\uFF12\uFF17.\uFF10.\uFF10.\uFF11/v1', '\uFF11'],
  ])('refuses %s with its own code before any request', async (url, fragment) => {
    const error = await ask('openai', { url });
    expect(error).toBeInstanceOf(PrismError);
    expect((error as PrismError).code).toBe('non_ascii_host_use_punycode');
    expect((error as PrismError).message).toBe(PUNYCODE_MESSAGE);
    expect((error as PrismError).message).not.toContain(fragment);
    expect(fake.sent).toHaveLength(0);
  });
});

describe('a capital sharp s in a per-call host', () => {
  it.each(['http://loca\u1E9Elhost/v1', 'http://127.0.0.1\u1E9E/v1', 'https://gateway\u1E9E.example/v1'])(
    'refuses %s with the host rule before any request',
    async (url) => {
      const error = await ask('openai', { url });
      expect(error).toBeInstanceOf(PrismError);
      expect((error as PrismError).code).toBe('private_address_refused');
      expect((error as PrismError).message).toBe(HOST_MESSAGE);
      expect(fake.sent).toHaveLength(0);
    },
  );
});

/*
 * An IPv6 literal may end in a dotted IPv4 address. It is the same address as
 * its hex spelling and is judged the same way: refused when it, or the IPv4
 * address it carries, is private.
 */
describe('an IPv6 per-call literal with a dotted IPv4 tail', () => {
  it.each(['http://[2606:4700::8.8.8.8]/v1', 'http://[2606:4700::1:8.8.8.8]/v1', 'http://[2606:4700::5efe:8.8.8.8]/v1'])(
    'dispatches to the public address %s',
    async (url) => {
      replyOnce();
      await ask('openai', { url });
      expect(fake.sent).toHaveLength(1);
    },
  );

  it.each([
    'http://[2606:4700::5efe:127.0.0.1]/v1', 'http://[64:ff9b::169.254.169.254]/latest',
    'http://[::ffff:0:10.0.0.5]/v1', 'http://[::127.0.0.1]/v1',
  ])('refuses %s before any request', async (url) => {
    expectRefused(await ask('openai', { url }), 'private_address_refused', url);
  });
});

describe('an ISATAP per-call literal behind a 6to4 prefix', () => {
  it.each(['http://[2002:808:808::5efe:7f00:1]/v1', 'http://[2002:808:808::5efe:169.254.169.254]/latest', 'http://[2606:4700::127.0.0.1.]/v1'])(
    'refuses %s before any request',
    async (url) => {
      const error = await ask('openai', { url });
      expect(error).toBeInstanceOf(PrismError);
      expect((error as PrismError).code).toBe('private_address_refused');
      expect(fake.sent).toHaveLength(0);
    },
  );
});

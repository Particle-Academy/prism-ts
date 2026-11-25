import { describe, expect, it } from 'vitest';
import { assertPerCallUrl } from '../src/internal/per-call-url.js';

/* Unit cases for the helper; the seam tests in per-call-url.test.ts are the proof. */

describe('assertPerCallUrl', () => {
  it.each([
    'https://gateway.example/v1', 'http://8.8.8.8/', 'http://[2606:4700::1111]/', 'http://example.com./',
    'http://1.2.3.4.example/', 'http://0x7f.example/',
  ])('allows %s', (url) => {
    expect(() => assertPerCallUrl(url)).not.toThrow();
  });

  it.each([
    'http://a.localhost/', 'http://localhost.localdomain/', 'http://ip6-localhost/', 'http://ip6-loopback/',
    'http://metadata/', 'http://instance-data/', 'http://127.0.0.1./', 'http://0x/', 'http://0/',
    'http://[2002:a9fe:a9fe::]/', 'http://[::]/',
  ])('refuses %s', (url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(expect.objectContaining({ code: 'private_address_refused' }) as Error);
  });

  it.each(['//127.0.0.1/', 'http:127.0.0.1', 'file:///etc/passwd', 'http://', 'http://08/'])('refuses %s as a scheme error', (url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(expect.objectContaining({ code: 'scheme_not_allowed' }) as Error);
  });

  it('does not resolve names: a public name that points at loopback is accepted (known limit)', () => {
    expect(() => assertPerCallUrl('http://127.0.0.1.nip.io/v1')).not.toThrow();
  });

  it.each(['http://loc%61lhost/', 'http://gate_way.example/', 'http://a.example\\@b.example/'])('refuses %s as written', (url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(expect.objectContaining({ code: 'private_address_refused' }) as Error);
  });
});

const HOST_MESSAGE =
  'A per-call provider url host may hold only letters, digits, hyphens and dots, or an IPv6 address in brackets.';

describe('assertPerCallUrl, hosts-file names and IPv4-carrying IPv6 forms', () => {
  it.each([
    'http://localhost4/', 'http://localhost4.localdomain4/', 'http://LOCALHOST6./', 'http://localhost6.localdomain6/',
    'http://ipv6-localhost/', 'http://ipv6-loopback/', 'http://ipv6-localnet/', 'http://ipv6-allhosts/',
    'http://ip6-localnet/', 'http://ip6-mcastprefix/', 'http://ip6-allnodes/', 'http://ip6-allrouters/',
    'http://broadcasthost/', 'http://box.localhost.localdomain/',
    'http://[::ffff:0:127.0.0.1]/', 'http://[::ffff:0:7f00:1]/', 'http://[::ffff:0:a9fe:a9fe]/', 'http://[::ffff:0:8.8.8.8]/',
    'http://[2001:4860::5efe:7f00:1]/', 'http://[2001:4860::200:5efe:a9fe:a9fe]/', 'http://[2001:4860::5efe:10.0.0.5]/',
  ])('refuses %s', (url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(expect.objectContaining({ code: 'private_address_refused' }) as Error);
  });

  it.each(['http://[2001:4860::5efe:808:808]/v1', 'https://localhost4.example/v1', 'https://xlocalhost6/v1'])('allows %s', (url) => {
    expect(() => assertPerCallUrl(url)).not.toThrow();
  });
});

/*
 * The guard on its own refuses a format, invisible or UTS46 deviation
 * character anywhere in the authority; no other check is relied on.
 */
describe('assertPerCallUrl, invisible and deviation characters', () => {
  it.each([
    ['joiner inside localhost', 'http://loca\u200Dlhost/'],
    ['non-joiner inside localhost', 'http://loca\u200Clhost/'],
    ['joiner after localhost', 'http://localhost\u200D/'],
    ['joiner before localhost', 'http://\u200Dlocalhost/'],
    ['joiner after loopback', 'http://127.0.0.1\u200D/'],
    ['joiner inside loopback', 'http://127.0.0.\u200D1/'],
    ['non-joiner after loopback', 'http://127.0.0.1\u200C/'],
    ['joiner after metadata ip', 'http://169.254.169.254\u200D/'],
    ['joiner after private ip', 'http://10.0.0.5\u200D/'],
    ['joiner after metadata name', 'http://metadata.google.internal\u200D/'],
    ['joiner in a public name', 'https://gate\u200Dway.example/v1'],
    ['soft hyphen', 'http://loca\u00ADlhost/'],
    ['word joiner', 'http://localhost\u2060/'],
    ['mongolian todo soft hyphen', 'http://loca\u1806lhost/'],
    ['mongolian vowel separator', 'http://localhost\u180E/'],
    ['variation selector', 'http://localhost\uFE0F/'],
    ['byte order mark', 'http://127.0.0.1\uFEFF/'],
    ['left-to-right mark', 'http://localhost\u200E/'],
    ['hangul filler', 'http://localhost\u3164/'],
    ['tag character', 'http://localhost\u{E0001}/'],
    ['no-break space', 'http://localhost\u00A0/'],
    ['capital sharp s (maps to a deviation)', 'http://loca\u1E9Elhost/'],
    ['capital sharp s after loopback', 'http://127.0.0.1\u1E9E/'],
    ['sharp s (deviation)', 'https://fa\u00DF.example/v1'],
    ['final sigma (deviation)', 'https://\u03BB\u03BF\u03B3\u03BF\u03C2.example/v1'],
    ['joiner in userinfo', 'http://user\u200D@gateway.example/v1'],
  ])('refuses the %s', (_label, url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(
      expect.objectContaining({ code: 'private_address_refused', message: HOST_MESSAGE }) as Error,
    );
  });
});

describe('assertPerCallUrl, non-ASCII hosts', () => {
  it.each([
    'https://b\u00FCcher.example/v1', 'http://\uFF11\uFF12\uFF17.\uFF10.\uFF10.\uFF11/', 'http://loc\uFF0561lhost/',
    'https://\u0645\u062B\u0627\u0644.3com.example/v1', 'https://b\u00FCcher.ab--cd.example/v1',
  ])('refuses %s with its own code', (url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(expect.objectContaining({ code: 'non_ascii_host_use_punycode' }) as Error);
  });

  it.each([
    'https://xn--bcher-kva.example/v1', 'https://xn--strae-oqa.de/v1', 'https://xn--mgbh0fb.3com.example/v1',
    'https://xn--bcher-kva.ab--cd.example/v1', 'https://b\u00FC@gateway.example/v1',
  ])('allows %s', (url) => {
    expect(() => assertPerCallUrl(url)).not.toThrow();
  });
});

describe('assertPerCallUrl, IPv6 literals with a dotted IPv4 tail', () => {
  it.each(['http://[2606:4700::8.8.8.8]/v1', 'http://[2606:4700::1:8.8.8.8]/v1', 'http://[2606:4700::5efe:8.8.8.8]/v1'])(
    'allows %s',
    (url) => {
      expect(() => assertPerCallUrl(url)).not.toThrow();
    },
  );

  it.each(['http://[2606:4700::5efe:127.0.0.1]/v1', 'http://[64:ff9b::169.254.169.254]/v1', 'http://[::127.0.0.1]/v1'])(
    'refuses %s',
    (url) => {
      expect(() => assertPerCallUrl(url)).toThrowError(expect.objectContaining({ code: 'private_address_refused' }) as Error);
    },
  );
});

describe('assertPerCallUrl, ISATAP behind a 6to4 prefix and a trailing dot in brackets', () => {
  it.each([
    'http://[2002:808:808::5efe:7f00:1]/v1', 'http://[2002:808:808::5efe:169.254.169.254]/v1',
    'http://[2002:808:808::200:5efe:a9fe:a9fe]/v1', 'http://[2606:4700::127.0.0.1.]/v1', 'http://[2606:4700::1.]/v1',
  ])('refuses %s', (url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(expect.objectContaining({ code: 'private_address_refused' }) as Error);
  });

  it('allows ISATAP of a public IPv4 behind a 6to4 prefix', () => {
    expect(() => assertPerCallUrl('http://[2002:808:808::5efe:808:808]/v1')).not.toThrow();
  });
});

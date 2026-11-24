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
    ['joiner inside localhost', 'http://loca‍lhost/'],
    ['non-joiner inside localhost', 'http://loca‌lhost/'],
    ['joiner after localhost', 'http://localhost‍/'],
    ['joiner before localhost', 'http://‍localhost/'],
    ['joiner after loopback', 'http://127.0.0.1‍/'],
    ['joiner inside loopback', 'http://127.0.0.‍1/'],
    ['non-joiner after loopback', 'http://127.0.0.1‌/'],
    ['joiner after metadata ip', 'http://169.254.169.254‍/'],
    ['joiner after private ip', 'http://10.0.0.5‍/'],
    ['joiner after metadata name', 'http://metadata.google.internal‍/'],
    ['joiner in a public name', 'https://gate‍way.example/v1'],
    ['soft hyphen', 'http://loca­lhost/'],
    ['word joiner', 'http://localhost⁠/'],
    ['mongolian todo soft hyphen', 'http://loca᠆lhost/'],
    ['mongolian vowel separator', 'http://localhost᠎/'],
    ['variation selector', 'http://localhost️/'],
    ['byte order mark', 'http://127.0.0.1﻿/'],
    ['left-to-right mark', 'http://localhost‎/'],
    ['hangul filler', 'http://localhostㅤ/'],
    ['tag character', 'http://localhost\u{E0001}/'],
    ['no-break space', 'http://localhost /'],
    ['sharp s (deviation)', 'https://faß.example/v1'],
    ['final sigma (deviation)', 'https://λογος.example/v1'],
    ['joiner in userinfo', 'http://user‍@gateway.example/v1'],
  ])('refuses the %s', (_label, url) => {
    expect(() => assertPerCallUrl(url)).toThrowError(
      expect.objectContaining({ code: 'private_address_refused', message: HOST_MESSAGE }) as Error,
    );
  });
});

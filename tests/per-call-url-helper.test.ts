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
});

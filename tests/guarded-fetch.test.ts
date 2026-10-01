import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Image, PrismError, PrismUrlRefused } from '../src/index.js';
import type { HostResolver } from '../src/index.js';

const publicResolver: HostResolver = { resolve: () => ['93.184.216.34'] };
afterEach(() => vi.unstubAllGlobals());

describe('the opt-in guarded media fetch', () => {
  it.each([
    ['file:///etc/passwd', 'scheme_not_allowed'],
    ['gopher://public.test/x', 'scheme_not_allowed'],
    ['//public.test/x.png', 'scheme_not_allowed'],
    ['http:public.test/x.png', 'scheme_not_allowed'],
    ['https://[invalid]/x', 'scheme_not_allowed'],
    ['http://169.254.169.254/latest/meta-data/', 'private_address_refused'],
    ['http://127.0.0.1/x', 'private_address_refused'],
    ['http://0x7f000001/x', 'private_address_refused'],
    ['http://2130706433/x', 'private_address_refused'],
    ['http://10.0.0.5/x', 'private_address_refused'],
    ['http://172.16.0.1/x', 'private_address_refused'],
    ['http://192.168.1.10/x', 'private_address_refused'],
    ['http://0.1.2.3/x', 'private_address_refused'],
    ['http://240.0.0.1/x', 'private_address_refused'],
    ['http://[::1]/x', 'private_address_refused'],
    ['http://[::]/x', 'private_address_refused'],
    ['http://[::127.0.0.1]/x', 'private_address_refused'],
    ['http://[::7f00:1]/x', 'private_address_refused'],
    ['http://[::2]/x', 'private_address_refused'],
    ['http://[fd00::1]/x', 'private_address_refused'],
    ['http://[fe80::1]/x', 'private_address_refused'],
    ['http://[::ffff:127.0.0.1]/x', 'private_address_refused'],
    ['http://[::ffff:93.184.216.34]/x', 'private_address_refused'],
  ])('refuses %s with %s before any request or DNS lookup', async (url, code) => {
    const fetch = vi.fn();
    const resolve = vi.fn(publicResolver.resolve);
    vi.stubGlobal('fetch', fetch);
    await expect(Image.fromUrl(url).fetchPublic({ resolver: { resolve } })).rejects.toMatchObject({ code });
    expect(fetch).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    [[], 'host_did_not_resolve'],
    [['10.0.0.5'], 'private_address_refused'],
    [['93.184.216.34', '10.0.0.5'], 'private_address_refused'],
    [['10.0.0.5', '93.184.216.34'], 'private_address_refused'],
    [['2001:4860:4860::8888', '::1'], 'private_address_refused'],
    [['not-an-ip'], 'private_address_refused'],
    [['::127.0.0.1'], 'private_address_refused'],
    [['::7f00:1'], 'private_address_refused'],
  ] as const)('checks every DNS answer %j before sending', async (addresses, code) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(Image.fromUrl('https://evil.test/x').fetchPublic({
      resolver: { resolve: async () => addresses },
    })).rejects.toMatchObject({ code });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the shipped DNS resolver to refuse localhost before HTTP', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(Image.fromUrl('http://localhost/x').fetchPublic()).rejects.toMatchObject({ code: 'private_address_refused' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['http://169.254.169.254/x', '//127.0.0.1/x', 'file:///etc/passwd', 'http://private.test/x'])('refuses a redirect to %s before requesting the target', async location => {
      const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
      vi.stubGlobal('fetch', fetch);
      await expect(Image.fromUrl('https://public.test/x').fetchPublic({ resolver: {
        resolve: host => host === 'public.test' ? ['93.184.216.34'] : ['10.0.0.5'],
      } })).rejects.toMatchObject({ code: 'redirect_refused' });
      expect(fetch.mock.calls).toHaveLength(1);
      expect(fetch).toHaveBeenCalledWith('https://public.test/x', { redirect: 'manual' });
    });

  it('rechecks the same hostname at each hop', async () => {
    const resolve = vi.fn().mockResolvedValueOnce(['93.184.216.34']).mockResolvedValueOnce(['10.0.0.5']);
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/next' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(Image.fromUrl('https://public.test/start').fetchPublic({ resolver: { resolve } }))
      .rejects.toMatchObject({ code: 'redirect_refused' });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([0, 2, 5])('bounds a redirect loop to %i hops with the exact reference code', async maxRedirects => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(Image.fromUrl('https://public.test/x').fetchPublic({ resolver: publicResolver, maxRedirects }))
      .rejects.toMatchObject({ code: 'too_many_redirects' });
    expect(fetch).toHaveBeenCalledTimes(maxRedirects + 1);
  });

  it('uses five redirects by default', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(Image.fromUrl('https://public.test/x').fetchPublic({ resolver: publicResolver }))
      .rejects.toMatchObject({ code: 'too_many_redirects' });
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it.each([302, 503])('cancels the unused body of a %i response before throwing', async status => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status, headers: { location: '/again' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(Image.fromUrl('https://public.test/x').fetchPublic({ resolver: publicResolver, maxRedirects: 0 }))
      .rejects.toMatchObject({ code: status === 302 ? 'too_many_redirects' : 'unfetchable_media' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 1.5, Infinity, NaN])('rejects an invalid hop bound %s before sending', async maxRedirects => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(Image.fromUrl('https://public.test/x').fetchPublic({ resolver: publicResolver, maxRedirects })).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches public IPv4 and IPv6 literals without DNS', async () => {
    const resolve = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('image', { headers: { 'content-type': 'image/png' } })));
    for (const url of ['https://93.184.216.34/x', 'https://[2001:4860:4860::8888]/x']) {
      const image = Image.fromUrl(url);
      expect(await image.fetchPublic({ resolver: { resolve } })).toBe(image);
      expect(image.hasRawContent()).toBe(true);
      expect(image.mimeType()).toBe('image/png');
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('follows public relative and absolute redirects manually, preserving an explicit mime type', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '../next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://other.test/final' } }))
      .mockResolvedValueOnce(new Response('bytes', { headers: { 'content-type': 'application/octet-stream' } }));
    vi.stubGlobal('fetch', fetch);
    const image = Image.fromUrl('https://public.test/a/start', 'image/png');
    await image.fetchPublic({ resolver: publicResolver });
    expect(fetch.mock.calls).toEqual([
      ['https://public.test/a/start', { redirect: 'manual' }],
      ['https://public.test/next', { redirect: 'manual' }],
      ['https://other.test/final', { redirect: 'manual' }],
    ]);
    expect(image.rawContent()).toEqual(new TextEncoder().encode('bytes'));
    expect(image.mimeType()).toBe('image/png');
  });

  it('does not disguise resolver or transport failures as a URL refusal', async () => {
    const failure = new Error('unrelated failure');
    await expect(Image.fromUrl('https://public.test/x').fetchPublic({ resolver: {
      resolve: () => { throw failure; },
    } })).rejects.toBe(failure);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await expect(Image.fromUrl('https://public.test/x').fetchPublic({ resolver: publicResolver })).rejects.toBe(failure);
  });

  it('redacts URL secrets when an admitted fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    await expect(Image.fromUrl('https://alice:password@public.test/x?token=SECRET').fetchPublic({ resolver: publicResolver }))
      .rejects.toThrow('https://public.test/x?[redacted] responded 403');
  });

  it('retains the existing no-URL error and PrismError catch compatibility', async () => {
    await expect(Image.fromBase64('aGk=').fetchPublic()).rejects.toMatchObject({ code: 'unfetchable_media' });
    const refusal = new PrismUrlRefused('private_address_refused', 'refused');
    expect(refusal).toBeInstanceOf(PrismError);
    expect(refusal.name).toBe('PrismUrlRefused');
  });

  it('prevents a real loopback request while unguarded fetch still reaches it', async () => {
    let requests = 0;
    const server = createServer((_req, res) => { requests++; res.end('bytes'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Expected TCP address');
      const url = `http://127.0.0.1:${address.port}/x`;
      await expect(Image.fromUrl(url).fetchPublic()).rejects.toMatchObject({ code: 'private_address_refused' });
      expect(requests).toBe(0);
      await Image.fromUrl(url).fetch();
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

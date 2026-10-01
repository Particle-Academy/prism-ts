import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CorpusLoader from '@particle-academy/prism-conformance';
import { Image, PrismUrlRefused } from '../src/index.js';

interface FetchCase {
  id: string;
  title: string;
  url: string;
  resolves: Record<string, string[]>;
  guarded?: boolean;
  redirects_to?: string;
  refusal: { php: string | null; ts: string | null; py: string | null };
  skipped: boolean;
}

// A missing corpus must fail: skipping it would report agreement without
// exercising a row. Keep the import dynamic so this diagnostic can run even
// when the package is absent, instead of failing Vite's import resolution.
const loaderPackage = '@particle-academy/prism-conformance';
let loader: typeof CorpusLoader;
try {
  loader = await import(loaderPackage) as typeof loader;
} catch (cause) {
  throw new Error(
    'Cannot load @particle-academy/prism-conformance. Clone prism-parity into ./.parity and run ' +
    '`npm install ./.parity/loaders/ts --no-save` AFTER npm ci; a later install can prune it.',
    { cause },
  );
}
// The loader's public types describe golden cases. This security corpus has
// refusal columns instead. PHP is the reference expectation, independent of
// the TypeScript observations recorded in newer corpus packages.
const cases = loader.Corpus.open().suite('media-fetch-guard').cases('ts') as unknown as FetchCase[];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

afterEach(() => vi.unstubAllGlobals());

describe('the media-fetch-guard corpus', () => {
  it('retains all eleven rows and both controls', () => {
    expect(cases.map(row => row.id)).toEqual(
      Array.from({ length: 11 }, (_, i) => `url-${String(i + 1).padStart(4, '0')}`),
    );
    expect(cases.every(row => row.skipped === false)).toBe(true);
    expect(cases.filter(row => row.refusal.php === null).map(row => row.id))
      .toEqual(['url-0001', 'url-0009']);
    expect(cases.find(row => row.id === 'url-0009')?.guarded).toBe(false);
  });

  it.each(cases)('$id agrees with PHP and sends only permitted requests ($title)', async row => {
    const sent: string[] = [];
    // Fresh fake per row: a previous control must not swallow this redirect.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      sent.push(url);
      if (row.redirects_to !== undefined && url !== row.redirects_to) {
        return new Response(null, { status: 302, headers: { location: row.redirects_to } });
      }
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }));
    const image = Image.fromUrl(row.url);
    let refusal: string | null = null;
    try {
      if (row.guarded === false) await image.fetch();
      else await image.fetchPublic({ resolver: { resolve: host => row.resolves[host] ?? [] } });
    } catch (error) {
      if (!(error instanceof PrismUrlRefused)) throw error;
      refusal = error.code;
    }
    expect(refusal).toBe(row.refusal.php);
    if (row.refusal.ts !== null) expect(refusal).toBe(row.refusal.ts);
    if (row.refusal.php === null) {
      expect(sent).toEqual([row.url]);
      expect(image.rawContent()).toEqual(new Uint8Array(png));
      expect(image.mimeType()).toBe('image/png');
    } else if (row.redirects_to !== undefined) {
      expect(sent).toEqual([row.url]);
      expect(sent).not.toContain(row.redirects_to);
      expect(image.hasRawContent()).toBe(false);
    } else {
      expect(sent).toEqual([]);
      expect(image.hasRawContent()).toBe(false);
    }
  });
});

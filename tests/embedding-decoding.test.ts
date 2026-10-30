import { Buffer } from 'node:buffer';
import { Corpus, compare } from '@particle-academy/prism-conformance';
import { describe, expect, it } from 'vitest';
import { Prism, PrismError, canonicalJson } from '../src/index.js';
import { parseEmbeddingsResponse as openai } from '../src/providers/openai/embeddings.js';
import { parseEmbeddingsResponse as mistral } from '../src/providers/mistral/embeddings.js';
import type { HttpTransport } from '../src/index.js';

type ReferenceResult = { embedding: number[] } | { exception: string };
interface EmbeddingCase {
  id: string;
  embedding: unknown;
  expected: { php: ReferenceResult };
  skipped: boolean;
}

// The installed loader supplies the canonical PHP observations. No private fixture
// copy, per-port null-column fallback, or optional-loader skip can turn this green.
const cases = Corpus.open().suite('embedding-decoding').cases('ts') as unknown as EmbeddingCase[];
const encoded = 'AACAPwAAIMAAAAA/AAAAAA==';
const body = (embedding: unknown) => ({ data: [{ index: 0, embedding }], usage: { total_tokens: 9 } });

it('executes all nine canonical rows without skips', () => {
  expect(cases).toHaveLength(9);
  expect(cases.filter((entry) => entry.skipped)).toEqual([]);
  expect(cases.filter((entry) => 'exception' in entry.expected.php)).toHaveLength(7);
});

for (const [provider, parse] of [['openai', openai], ['mistral', mistral]] as const) {
  describe(`${provider} embedding decoding`, () => {
    it.each(cases)('$id matches the executed PHP reference', (entry) => {
      let actual: ReferenceResult;

      try {
        const response = parse(body(entry.embedding));
        expect(response.embeddings).toHaveLength(1);
        actual = { embedding: [...response.embeddings[0]!.embedding] };
      } catch (error) {
        // A native crash or an unrelated PrismError must never count as refusal.
        expect(error).toBeInstanceOf(PrismError);
        expect((error as PrismError).code).toBe('invalid_embedding');
        actual = { exception: 'Prism\\Prism\\Exceptions\\PrismException' };
      }

      expect(compare(canonicalJson(entry.expected.php), canonicalJson(actual))).toBe(true);
    });

    it.each([
      ['whitespace', `${encoded}\n`],
      ['missing padding', encoded.slice(0, -2)],
      ['extra padding', `${encoded}=`],
      ['URL-safe alphabet', '____fw=='],
      ['non-ASCII alphabet', `é${encoded}`],
      ['one byte', 'AA=='],
      ['three bytes', 'AAAA'],
      ['negative infinity', 'AACA/w=='],
      ['boolean', false],
      ['number', 42],
      ['object', {}],
      ['missing embedding', undefined],
    ])('rejects %s with a coded error and no raw payload', (_title, value) => {
      try {
        parse(body(value));
        expect.fail('Malformed embeddings must not return a vector.');
      } catch (error) {
        expect(error).toBeInstanceOf(PrismError);
        const failure = error as PrismError;
        expect(failure.code).toBe('invalid_embedding');
        expect(failure.responseBody).toBeNull();
        expect(failure.cause).toBeUndefined();
        expect(failure.message).toMatch(/^Invalid embedding: /);
        if (typeof value === 'string') expect(failure.message).not.toContain(value);
      }
    });

    it('preserves finite float32 extremes and signed zero', () => {
      // Fixed IEEE-754 words, independent of the decoder's float packing path.
      const bytes = Buffer.from('0000008001000000ffff7f7f', 'hex');
      const values = parse(body(bytes.toString('base64'))).embeddings[0]!.embedding;
      expect(Object.is(values[0], -0)).toBe(true);
      expect(values.slice(1)).toEqual([2 ** -149, (2 - 2 ** -23) * 2 ** 127]);
    });

    it('keeps the existing numeric-array behavior, including an empty array', () => {
      expect(parse(body([1, null, -2.5])).embeddings[0]!.embedding).toEqual([1, -2.5]);
      expect(parse(body([])).embeddings[0]!.embedding).toEqual([]);
    });

    it('rejects the whole response when one vector is corrupt', () => {
      expect(() => parse({ data: [{ embedding: encoded }, { embedding: 'not!base64' }] }))
        .toThrowError(expect.objectContaining({ code: 'invalid_embedding' }));
    });

    it('decodes through the public request path while preserving ordering and usage', async () => {
      const transport: HttpTransport = () => Promise.resolve({
        status: 200, headers: {}, rawBody: '',
        body: { data: [{ index: 1, embedding: encoded }, { index: 0, embedding: [3] }], usage: { total_tokens: 9 } },
      });
      const response = await Prism.embeddings()
        .using(provider, 'test-embedding', { apiKey: 'test-only', transport })
        .fromArray(['first', 'second']).asEmbeddings();

      expect(response.embeddings.map((entry) => entry.embedding)).toEqual([[3], [1, -2.5, 0.5, 0]]);
      expect(response.usage.tokens).toBe(9);
    });
  });
}

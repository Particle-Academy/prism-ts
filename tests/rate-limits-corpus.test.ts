import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRateLimits as anthropicLimits } from '../src/providers/anthropic/rate-limits.js';
import { parseRateLimits as mistralLimits } from '../src/providers/mistral/rate-limits.js';
import { parseRateLimits as openaiLimits } from '../src/providers/openai/rate-limits.js';

/**
 * The cross-language `provider-rate-limits` corpus from `prism-parity`.
 *
 * Quota is a fact about an ACCOUNT, not about a process. A PHP worker and this
 * one drawing on the same key both read these headers to decide whether to send
 * the next request, and a record of what the provider said is routinely written
 * by one service and read back by another. A disagreement never errors — one
 * language throttles on a bucket the other cannot see, or retries into a limit
 * it believes has lifted.
 *
 * **This port disagrees with the reference on nine of the sixteen rows**, and
 * the corpus records every one. They are pinned here rather than silently
 * closed: three of them are outright defects in this port (see the `it` blocks
 * below), and a fix has to update the corpus in the same breath, which is the
 * only thing that makes the fix visible to the other two languages.
 *
 * Mirrors prism-py/tests/test_provider_rate_limits_corpus.py case for case.
 */
interface Bucket {
  name: string;
  limit: number | null;
  remaining: number | null;
  resets_at: string | null;
}

interface Answer {
  outcome: 'ok' | 'raised';
  buckets: Bucket[] | null;
}

interface CorpusCase {
  id: string;
  title: string;
  notes: string;
  given: { provider: string; now: number; headers: Record<string, string> };
  result: { php: Answer | null; ts: Answer | null; py: Answer | null };
  agrees: boolean;
}

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/provider-rate-limits.json', import.meta.url), 'utf8'),
) as { cases: CorpusCase[] };

const caseOf = (id: string): CorpusCase => corpus.cases.find((entry) => entry.id === id)!;

function read(entry: CorpusCase): Answer {
  // Frozen per row. Both duration readers call `Date.now()` directly rather than
  // taking an injectable clock, so without this every OpenAI and Mistral row
  // would measure elapsed time instead of comparing implementations.
  vi.useFakeTimers();
  vi.setSystemTime(entry.given.now * 1000);

  try {
    // Header names are handed over with their case INTACT. Lower-casing here
    // would answer prl-0008 in the test instead of in the package.
    const readers: Record<string, (headers: Record<string, string>) => { toObject(): unknown }[]> =
      {
        anthropic: anthropicLimits,
        mistral: mistralLimits,
        openai: openaiLimits,
      };

    const buckets = readers[entry.given.provider]!(entry.given.headers).map(
      (limit) => limit.toObject() as unknown as Bucket,
    );

    return { outcome: 'ok', buckets };
  } catch {
    return { outcome: 'raised', buckets: null };
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the cross-language provider-rate-limits corpus', () => {
  it('is the whole suite, not a subset someone trimmed to green', () => {
    expect(corpus.cases).toHaveLength(16);
  });

  it.each(corpus.cases)('$id reads the way the corpus recorded ($title)', (entry) => {
    expect(read(entry)).toEqual(entry.result.ts);
  });

  it('disagrees on exactly the rows the corpus says it disagrees on', () => {
    // Asserted from both directions: a test that only listed the agreeing rows
    // would pass just as happily if a divergence were quietly closed, and the
    // point of this suite is that closing one is deliberate.
    expect(corpus.cases.filter((entry) => !entry.agrees).map((entry) => entry.id)).toEqual([
      'prl-0001',
      'prl-0002',
      'prl-0003',
      'prl-0004',
      'prl-0005',
      'prl-0006',
      'prl-0008',
      'prl-0014',
      'prl-0015',
      'prl-0016',
    ]);
  });

  it('returns nothing at all for a real Mistral response', () => {
    // The largest single divergence. Mistral sends `ratelimitbysize-limit` with
    // NO bucket segment — the spelling the reference reads and its own tests
    // assert against — while this port reads `ratelimitbysize-limit-tokens`. The
    // result is an empty list, which is indistinguishable from a provider that
    // sent no quota headers at all.
    expect(caseOf('prl-0014').result.ts).toEqual({ outcome: 'ok', buckets: [] });
    expect(caseOf('prl-0014').result.php?.buckets).toHaveLength(1);
  });

  it('cannot see a bucket it did not enumerate', () => {
    // Anthropic meters web search separately. The reference walks the prefix and
    // reports it; this port lists four names and reports nothing.
    expect(caseOf('prl-0003').result.ts).toEqual({ outcome: 'ok', buckets: [] });
  });

  it('drops a reset the provider sent as a unix epoch', () => {
    // `new Date('1735689600')` is an Invalid Date, so the reset vanishes without
    // a word. The reference has a test named for this exact header shape.
    expect(caseOf('prl-0002').result.ts?.buckets?.[0]?.resets_at).toBeNull();
    expect(caseOf('prl-0002').result.php?.buckets?.[0]?.resets_at).toBe('2025-01-01T00:00:00+00:00');
  });

  it('orders the buckets by its own list rather than by the response', () => {
    // The CONTROL row disagrees, and only on order. Nothing errors; a caller
    // reading `rateLimits[0]` simply gets a different bucket in each language.
    expect(caseOf('prl-0001').result.ts?.buckets?.map((bucket) => bucket.name)).toEqual([
      'requests',
      'tokens',
      'input-tokens',
      'output-tokens',
    ]);
    expect(caseOf('prl-0001').result.php?.buckets?.map((bucket) => bucket.name)).toEqual([
      'requests',
      'input-tokens',
      'output-tokens',
      'tokens',
    ]);
  });

  it('keeps the response when a reset is unparseable, which the reference does not', () => {
    // The one row where this port is safer than the reference: an unreadable
    // reset costs the reset, not the already-paid-for completion.
    expect(caseOf('prl-0006').result.ts?.outcome).toBe('ok');
    expect(caseOf('prl-0006').result.php?.outcome).toBe('raised');
  });
});

import { describe, expect, it } from 'vitest';
import { Corpus } from '@particle-academy/prism-conformance';
import type { Probe } from '@particle-academy/prism-conformance';
import * as lib from '../src/index.js';
import { failuresBySuite, runCorpus } from '../conformance/driver.mjs';
import { isKnownProbe } from '../conformance/mutations.mjs';

/**
 * Discrimination, not decoration.
 *
 * A conformance table every plausible implementation passes measures nothing.
 * Each probe injects one deliberate defect, and the corpus declares the EXACT
 * set of case ids it must fail. This asserts equality with that set — not that
 * it is non-empty, and not that it is a superset. Both directions matter: a set
 * that shrank means the corpus stopped catching a mistake, and a set that grew
 * means a row is failing for a reason nobody intended.
 *
 * The probe test runs the SOURCE; the CLI runs the build. Same driver, same
 * corpus, same mutations.
 */

const corpus = Corpus.open();
const LANGUAGE = 'ts';

interface CorpusCorrection {
  reason: string;
  failures: Record<string, string[]>;
}

/**
 * Where measurement disagrees with the corpus's declaration.
 *
 * EMPTY, and that is the state to be in: every probe agrees with the corpus as
 * shipped. The mechanism stays because the next disagreement belongs here — in
 * the open, with its reasoning — and not patched into probes.json, since
 * editing the answer key to match the output turns the whole check into a
 * tautology.
 *
 * This port carried two entries. Both were adjudicated upstream and the corpus
 * was corrected, so both were deleted: `keep-empty-tools` under-declared its
 * failing set, and the response-parsing half of the null-dropping hazard became
 * its own probe, `omit-null-on-parse`.
 *
 * A correction may only ever ADD failures — see 'the correction mechanism'
 * below, which proves that rule against synthetic input so it is exercised even
 * while this map is empty.
 */
const CORPUS_CORRECTIONS: Record<string, CorpusCorrection> = {};

/**
 * The rule a correction must obey: strictly more failures than the corpus
 * declares, never fewer. A correction that removed a declared row would be
 * laundering a real regression through this file.
 */
function violatesSupersetRule(declared: string[], corrected: string[]): boolean {
  const correctedSet = new Set(corrected);

  return declared.some((id) => !correctedSet.has(id)) || corrected.length <= declared.length;
}

const probes: Probe[] = corpus.probes().probes.filter((probe) => probe.languages.includes(LANGUAGE));

/** `suite/case` strings, sorted — so a failure in an UNDECLARED suite still shows up. */
function flatten(failures: Record<string, string[]>): string[] {
  return Object.entries(failures)
    .flatMap(([suite, ids]) => ids.map((id) => `${suite}/${id}`))
    .sort();
}

function observe(probeId: string): string[] {
  return flatten(failuresBySuite(runCorpus({ lib, corpus, probe: probeId, language: LANGUAGE })));
}

function expectation(probe: Probe): string[] {
  const correction = CORPUS_CORRECTIONS[probe.id];

  return flatten(correction?.failures ?? corpus.expectedProbeFailures(probe.id, LANGUAGE));
}

/** Both directions of the difference, so a red test says which way it went. */
function difference(expected: string[], observed: string[]): { missing: string[]; unexpected: string[] } {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);

  return {
    missing: expected.filter((id) => !observedSet.has(id)),
    unexpected: observed.filter((id) => !expectedSet.has(id)),
  };
}

describe('the corpus itself', () => {
  it('ships the suites and probes this runner was built against', () => {
    // The suites this runner RUNS, which is not every suite the corpus ships.
    // A `security-corpus` suite has no `expect` — each row records what every
    // language produced, per language — so it is run in the family's own three
    // repositories rather than from here, and the runner skips it by kind.
    //
    // Filtered rather than listed, deliberately. A hardcoded list goes stale
    // every time the corpus grows a suite this runner was never meant to touch,
    // and the stale failure teaches you to widen the list rather than to look.
    // Filtering by kind keeps the assertion pointed at the real hazard: a NEW
    // golden-based suite appearing that nobody taught this runner about still
    // fails here.
    const runnable = corpus
      .suiteIds()
      .filter((id) => corpus.suite(id).manifest.kind !== 'security-corpus');

    expect(runnable).toEqual([
      // Every row is SKIPPED for this language (G-49: Anthropic response
      // citations are not ported), but the suite still has to be listed --
      // this pin asserts what the corpus SHIPS, not what this runner passes.
      // Dropping it here would hide a whole suite arriving unnoticed.
      'anthropic-text-response',
      'json-container-identity',
      'openai-text-request',
      'openai-text-response',
      'value-object-roundtrip',
      'text-errors',
    ].sort());

    expect(corpus.digest()).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(probes.length).toBeGreaterThan(1);
  });

  it('declares no probe this runner cannot implement', () => {
    expect(probes.filter((probe) => !isKnownProbe(probe.id)).map((probe) => probe.id)).toEqual([]);
  });
});

describe('the faithful control', () => {
  /**
   * Not optional. Without an implementation that passes everything, the mutants
   * prove only that the port is broken.
   */
  it('fails nothing, in any suite', () => {
    expect(observe('faithful')).toEqual([]);
  });

  it('reports every case in the corpus, skips included', () => {
    const documents = runCorpus({ lib, corpus, probe: 'faithful', language: LANGUAGE });

    for (const document of documents) {
      const suite = corpus.suite(document.suite);

      // A skip that vanishes from the report is a suite that quietly shrank.
      expect(document.results.map((result) => result.id)).toEqual(suite.cases(LANGUAGE).map((row) => row.id));
      expect(document.results.filter((result) => result.status === 'skip').map((result) => result.id)).toEqual(
        suite.skippedIds(LANGUAGE),
      );

      for (const result of document.results.filter((row) => row.status === 'skip')) {
        expect(result.reason).toBeTruthy();
      }
    }
  });
});

describe('discrimination probes', () => {
  for (const probe of probes.filter((candidate) => candidate.kind === 'mutant')) {
    it(`${probe.id} fails exactly the declared set`, () => {
      const expected = expectation(probe);
      const observed = observe(probe.id);

      expect(difference(expected, observed)).toEqual({ missing: [], unexpected: [] });
    });

    it(`${probe.id} fails something`, () => {
      // A mutant that fails nothing is not a mutant; it means the defect was
      // never actually injected, and every other assertion about it is vacuous.
      expect(observe(probe.id).length).toBeGreaterThan(0);
    });
  }
});

describe('the correction mechanism', () => {
  /**
   * Proven against synthetic input rather than only against whatever happens to
   * be outstanding. A guard that runs only when it is needed is a guard nobody
   * has watched work — and right now nothing is outstanding, so without these
   * three the rule would be dead code wearing a test's clothes.
   */
  it('accepts a correction that only ADDS failures', () => {
    expect(violatesSupersetRule(['s/a'], ['s/a', 's/b'])).toBe(false);
  });

  it('rejects a correction that drops a declared failure', () => {
    expect(violatesSupersetRule(['s/a', 's/b'], ['s/b', 's/c'])).toBe(true);
  });

  it('rejects a correction that changes nothing', () => {
    expect(violatesSupersetRule(['s/a'], ['s/a'])).toBe(true);
  });

  it('names only probes the corpus actually declares', () => {
    const declared = new Set(probes.map((probe) => probe.id));

    expect(Object.keys(CORPUS_CORRECTIONS).filter((id) => !declared.has(id))).toEqual([]);
  });

  for (const [probeId, correction] of Object.entries(CORPUS_CORRECTIONS)) {
    it(`${probeId}: the outstanding correction obeys the rule and says why`, () => {
      const declared = flatten(corpus.expectedProbeFailures(probeId, LANGUAGE));

      expect(violatesSupersetRule(declared, flatten(correction.failures))).toBe(false);
      expect(correction.reason.length).toBeGreaterThan(80);
    });
  }
});

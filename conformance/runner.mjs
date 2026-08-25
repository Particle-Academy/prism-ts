#!/usr/bin/env node
// The prism-ts conformance runner.
//
// A subprocess contract on purpose: prism-parity's cross-check runs every
// port's runner and requires IDENTICAL VERDICTS, which is a stronger claim than
// three suites that each went green on their own. Three green ticks are not a
// three-way comparison.
//
// stdout is JSON and nothing else. stderr is for humans.

import process from 'node:process';
// `./mutations.mjs` has no dependencies of its own, so it is safe to import
// statically. `./driver.mjs` is NOT: it imports the conformance loader, and a
// static import of it would fail the module graph before main() runs — which is
// precisely how the missing-loader guard below can look correct and never
// execute. It is imported dynamically, inside the guard.
import { isKnownProbe } from './mutations.mjs';

const EXIT_OK = 0;
const EXIT_FAILURES = 1;
const EXIT_CORPUS = 2;
const EXIT_CANNOT_START = 3;

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (!argument.startsWith('--')) continue;

    const key = argument.slice(2);
    const next = argv[index + 1];

    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return options;
}

function writeOut(text) {
  process.stdout.write(`${text}\n`);
}

function writeErr(text) {
  process.stderr.write(`${text}\n`);
}

function fatal(code, message) {
  writeOut(JSON.stringify({ error_code: code, error: message }));

  process.exit(EXIT_CORPUS);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  let loader;
  let driver;
  let lib;

  // No fallback and no vendored copy. A runner that limps along without the
  // published corpus is a runner that reports agreement it never measured.
  try {
    loader = await import('@particle-academy/prism-conformance');
  } catch (error) {
    writeErr(
      `Cannot load @particle-academy/prism-conformance: ${error?.message ?? String(error)}\n` +
        'Install it the way CI does: clone prism-parity into ./.parity and run `npm install ./.parity/loaders/ts`.\n' +
        'Install the loader LAST — it is installed --no-save, so a later `npm install` prunes it as extraneous.',
    );

    process.exit(EXIT_CANNOT_START);
  }

  try {
    driver = await import('./driver.mjs');
  } catch (error) {
    writeErr(`Cannot load the conformance driver: ${error?.message ?? String(error)}`);

    process.exit(EXIT_CANNOT_START);
  }

  try {
    lib = await import('../dist/index.js');
  } catch (error) {
    writeErr(`Cannot load the built library from dist/: ${error?.message ?? String(error)}\nRun \`npm run build\` first.`);

    process.exit(EXIT_CANNOT_START);
  }

  let corpus;

  try {
    corpus = loader.Corpus.open(typeof options.root === 'string' ? options.root : undefined);
  } catch (error) {
    fatal(error?.code ?? 'corpus_not_installed', error?.message ?? String(error));
  }

  // Printed on EVERY run. A port pinned to a stale corpus otherwise stays green
  // against a contract that has moved on, and nobody is told. The digest is
  // what catches an artifact whose CONTENT moved without its version moving.
  let digest;

  try {
    digest = corpus.digest();
  } catch (error) {
    fatal(error?.code ?? 'corpus_not_installed', error?.message ?? String(error));
  }

  writeErr(`prism-parity corpus ${corpus.version} (${digest}) root: ${corpus.root}`);

  if (options.version === true) {
    writeOut(corpus.version);

    process.exit(EXIT_OK);
  }

  // Establish the corpus is USABLE before validating what was asked of it: a
  // corpus with nothing in it is the more fundamental problem, and reporting
  // "unknown probe" first would bury it.
  let suiteIds;

  try {
    suiteIds = typeof options.suite === 'string' ? [options.suite] : corpus.suiteIds();

    // Touch every suite up front so a malformed one is a corpus error rather
    // than a mid-run crash reported as a case failure.
    for (const suiteId of suiteIds) corpus.suite(suiteId);
  } catch (error) {
    fatal(error?.code ?? 'corpus_not_installed', error?.message ?? String(error));
  }

  // Vacuity guard. A corpus that loads and yields NO suites is a failure, not a
  // run that passed everything it was asked about. The mechanism being correct
  // and silently not running is the same hazard as a stale artifact reporting
  // one suite fewer and looking perfectly green.
  if (suiteIds.length === 0) {
    fatal(
      'empty_corpus',
      `The corpus at ${corpus.root} loaded but ships no suites, so this run would have asserted nothing.`,
    );
  }

  const probe = typeof options.probe === 'string' ? options.probe : 'faithful';
  let declaredProbes;

  try {
    declaredProbes = corpus.probes().probes;
  } catch (error) {
    fatal(error?.code ?? 'corpus_not_installed', error?.message ?? String(error));
  }

  const declared = declaredProbes.find((candidate) => candidate.id === probe);

  if (declared === undefined) {
    fatal('unknown_probe', `No probe named ${probe}.`);
  }

  if (!declared.languages.includes('ts')) {
    writeOut(JSON.stringify({ corpus_version: corpus.version, corpus_digest: digest, language: 'ts', unsupported_probe: probe, results: [] }));

    process.exit(EXIT_OK);
  }

  if (!isKnownProbe(probe)) {
    writeErr(`The corpus declares a probe named ${probe} that this runner does not implement.`);

    process.exit(EXIT_CANNOT_START);
  }

  const documents = driver.runCorpus({ lib, corpus, suiteIds, probe });

  writeOut(JSON.stringify(documents.length === 1 ? documents[0] : documents));

  // Under a probe a mutant is EXPECTED to fail cases, but the exit code stays
  // as-is and the caller — cross-check, or the port's own probe test — does the
  // judging. A runner that decided for itself would need the answer key.
  process.exit(Object.keys(driver.failuresBySuite(documents)).length > 0 ? EXIT_FAILURES : EXIT_OK);
}

await main();

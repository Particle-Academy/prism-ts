import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Corpus } from '@particle-academy/prism-conformance';
import { describe, expect, it } from 'vitest';

interface Result {
  id: string;
  status: string;
}

interface Document {
  suite: string;
  results: Result[];
}

const corpus = Corpus.open();
const cwd = fileURLToPath(new URL('../', import.meta.url));
const preload = new URL('./fixtures/delayed-stdout.mjs', import.meta.url).href;
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOME|USERPROFILE|LANG|LC_ALL|PRISM_PARITY_ROOT)$/i.test(key),
  ),
);

function run(probe: string) {
  return spawnSync(process.execPath, ['--import', preload, 'conformance/runner.mjs', '--probe', probe], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 25_000,
    windowsHide: true,
  });
}

function completeReport(stdout: string): Document[] {
  const documents = JSON.parse(stdout) as Document[];
  const suites = corpus.suiteIds().filter((id) => corpus.suite(id).manifest.kind !== 'security-corpus');

  expect(documents.map((document) => document.suite).sort()).toEqual([...suites].sort());

  for (const document of documents) {
    expect(document.results.map((result) => result.id)).toEqual(
      [...corpus.suite(document.suite).cases('ts')].map((testCase) => testCase.id),
    );
  }

  return documents;
}

describe('conformance stdout under asynchronous backpressure', () => {
  it('drains the complete native corpus report before a successful exit', () => {
    const result = run('faithful');

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);

    const documents = completeReport(result.stdout);

    expect(result.stdout.length).toBeGreaterThan(65_536);
    expect(documents.flatMap((document) => document.results).filter((row) => row.status === 'fail')).toEqual([]);
  }, 30_000);

  it('drains every row and preserves exit 1 for an actual failing probe', () => {
    const result = run('omit-null-keys');

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);

    const documents = completeReport(result.stdout);
    const actual = Object.fromEntries(
      documents
        .map((document) => [document.suite, document.results.filter((row) => row.status === 'fail').map((row) => row.id)] as const)
        .filter(([, failures]) => failures.length > 0),
    );

    expect(result.stdout.length).toBeGreaterThan(65_536);
    expect(Object.values(actual).flat().length).toBeGreaterThan(0);
    expect(actual).toEqual(corpus.expectedProbeFailures('omit-null-keys', 'ts'));
  }, 30_000);
});

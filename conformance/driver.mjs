// Drives prism-ts from a corpus builder script.
//
// The library is INJECTED rather than imported, so the CLI can run the built
// package while the probe test runs the source — same driver, same corpus, same
// mutations, one code path.

import { compare } from '@particle-academy/prism-conformance';
import { mutate, mutateRehydration } from './mutations.mjs';

/**
 * Typed at the boundary so the probe test — which is TypeScript — gets real
 * types out of this module rather than a wall of implicit `any`.
 *
 * @typedef {typeof import('../src/index.js')} Library
 * @typedef {import('@particle-academy/prism-conformance').Corpus} Corpus
 * @typedef {import('@particle-academy/prism-conformance').Suite} Suite
 * @typedef {import('@particle-academy/prism-conformance').Language} Language
 * @typedef {{ id: string, status: 'pass' | 'skip' | 'fail', reason?: string | null, expected?: string, actual?: string }} CaseResult
 * @typedef {{ corpus_version: string, corpus_digest: string, language: string, suite: string, probe: string, results: CaseResult[] }} ReportDocument
 */

/** @type {Language} */
export const LANGUAGE = 'ts';

/**
 * Tagged constructs, as constructor arguments in canonical order.
 *
 * The corpus names a construct's arguments by their canonical (PHP) names; the
 * call SEQUENCE and the argument NAMES are the contract, the positional order
 * of any one language is not. This table is where the two meet.
 */
const CONSTRUCTS = {
  UserMessage: ['content', 'additionalContent', 'additionalAttributes'],
  AssistantMessage: ['content', 'toolCalls', 'additionalContent', 'toolApprovalRequests'],
  SystemMessage: ['content'],
  ToolResultMessage: ['toolResults', 'toolApprovalResponses'],
  ToolCall: ['id', 'name', 'arguments', 'resultId', 'reasoningId', 'reasoningSummary'],
  ToolResult: ['toolCallId', 'toolName', 'args', 'result', 'toolCallResultId', 'artifacts'],
  Usage: ['promptTokens', 'completionTokens', 'cacheWriteInputTokens', 'cacheReadInputTokens', 'thoughtTokens', 'cost'],
  Meta: ['id', 'model', 'rateLimits', 'serviceTier'],
  ProviderTool: ['type', 'name', 'options'],
};

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Turn a `{"$": "..."}` construct into a real value object, depth first. */
export function hydrate(lib, value) {
  if (Array.isArray(value)) return value.map((item) => hydrate(lib, item));

  if (!isObject(value) || !('$' in value)) return value;

  const tag = value.$;

  if (tag === 'ToolChoice') return lib.toolChoiceFromName(value.case);
  if (tag === 'Tool') return hydrateTool(lib, value);

  const parameters = CONSTRUCTS[tag];

  if (parameters === undefined) throw new Error(`Unknown construct ${tag}.`);

  const Construct = lib[tag];

  if (typeof Construct !== 'function') throw new Error(`The port exports no ${tag}.`);

  // Trailing arguments the case did not name are left off entirely so the
  // constructor's own defaults apply, rather than being forced to undefined.
  const args = parameters.map((name) => (name in value ? hydrate(lib, value[name]) : undefined));

  while (args.length > 0 && args.at(-1) === undefined) args.pop();

  return new Construct(...args);
}

function hydrateTool(lib, spec) {
  let tool = new lib.Tool().as(spec.as).for(spec.for);

  for (const parameter of spec.parameters ?? []) {
    const Schema = { string: lib.StringSchema, number: lib.NumberSchema, boolean: lib.BooleanSchema }[parameter.type];

    if (Schema === undefined) throw new Error(`Unknown parameter type ${parameter.type}.`);

    tool = tool.withParameter(new Schema(parameter.name, parameter.description), parameter.required ?? true);
  }

  if (spec.providerOptions !== undefined) tool = tool.withProviderOptions(spec.providerOptions);

  // A tool needs a handler to be a tool, but the corpus never invokes one:
  // these suites pin mapping, not execution.
  return tool.using(() => 'conformance');
}

/** Replay a builder script against a fresh pending request. */
export function pending(lib, script) {
  let request = lib.Prism.text();

  for (const step of script ?? []) {
    if (typeof request[step.call] !== 'function') {
      throw new Error(`The port's builder has no method ${step.call}.`);
    }

    request = request[step.call](...(step.args ?? []).map((argument) => hydrate(lib, argument)));
  }

  return request;
}

function buildBody(lib, request, probe) {
  return mutate(probe, 'requestBody', lib.buildRequestBody(request), { lib, request });
}

function rehydrate(lib, tag, object, probe) {
  const mutated = mutateRehydration(probe, { lib, tag, object });

  if (mutated !== null) return mutated;

  const Construct = lib[tag];

  if (typeof Construct?.fromObject !== 'function') {
    throw new Error(`The port cannot rebuild a ${tag}: no fromObject.`);
  }

  return Construct.fromObject(object);
}

/**
 * Evaluate one case.
 *
 * Returns `{ expected, actual }` for the primary assertion, plus an optional
 * `secondary` for the roundtrip suite's rehydration half — which is reported as
 * an ordinary fail on the same case id, because a value object that serialises
 * correctly and rebuilds wrong is exactly the defect this corpus exists to
 * catch, and hiding it behind its own status would let it be filtered out.
 */
function evaluate(lib, manifest, testCase, probe) {
  switch (manifest.kind) {
    case 'request-payload': {
      const request = pending(lib, testCase.builder).toRequest();

      return { expected: testCase.expect.body_json, actual: lib.canonicalJson(buildBody(lib, request, probe)) };
    }

    case 'response-parse': {
      const request = pending(lib, testCase.builder).toRequest();
      const parsed = lib.parseTextResponse(request, testCase.response).toObject();

      return {
        expected: testCase.expect.result_json,
        actual: lib.canonicalJson(mutate(probe, 'parsedResult', parsed, { lib, request })),
      };
    }

    case 'roundtrip': {
      const subject = hydrate(lib, testCase.subject);
      const serialize = (value) => lib.canonicalJson(mutate(probe, 'serialized', value.toObject(), { lib }));
      const actual = serialize(subject);

      if (testCase.expect.rehydrates !== true) {
        return { expected: testCase.expect.serialized_json, actual };
      }

      return {
        expected: testCase.expect.serialized_json,
        actual,
        // Rebuild from what would actually have been STORED — the serialized
        // form — and require re-serialising it to return the identical bytes.
        secondary: () => ({
          expected: actual,
          actual: serialize(rehydrate(lib, testCase.subject.$, JSON.parse(actual), probe)),
          reason: 'rehydrated and re-serialised to different bytes',
        }),
      };
    }

    case 'error-code': {
      let code = 'no_error';

      try {
        const request = pending(lib, testCase.builder).toRequest();

        buildBody(lib, request, probe);
      } catch (error) {
        // Codes only. Prose is idiomatic per language and pinning it would hold
        // every implementation to a translation.
        code = typeof error?.code === 'string' ? error.code : `unmapped:${error?.message}`;
      }

      return { expected: testCase.expect.error_code, actual: code };
    }

    case 'container-identity': {
      // The one suite with no decoded input: it can only be answered by parsing
      // the raw text, which is what proves the raw-string channel is wired to
      // something rather than merely present.
      const left = JSON.stringify(JSON.parse(testCase.left_raw));
      const right = JSON.stringify(JSON.parse(testCase.right_raw));

      return {
        expected: lib.canonicalJson(testCase.expect.equal_after_parse),
        actual: lib.canonicalJson(left === right),
      };
    }

    default:
      throw new Error(`Unknown suite kind ${manifest.kind}.`);
  }
}

/**
 * Run one suite, returning a row for EVERY case including the skipped ones.
 *
 * @param {{ lib: Library, suite: Suite, probe?: string, language?: Language }} options
 * @returns {CaseResult[]}
 */
export function runSuite({ lib, suite, probe = 'faithful', language = LANGUAGE }) {
  /** @type {CaseResult[]} */
  const results = [];

  for (const testCase of suite.cases(language)) {
    if (testCase.skipped) {
      results.push({ id: testCase.id, status: 'skip', reason: testCase.skipReason });

      continue;
    }

    let outcome;

    try {
      outcome = evaluate(lib, suite.manifest, testCase, probe);
    } catch (error) {
      results.push({ id: testCase.id, status: 'fail', reason: `threw: ${error?.message ?? String(error)}` });

      continue;
    }

    if (!compare(outcome.expected, outcome.actual, testCase.tolerance)) {
      results.push({ id: testCase.id, status: 'fail', expected: outcome.expected, actual: outcome.actual });

      continue;
    }

    if (outcome.secondary === undefined) {
      results.push({ id: testCase.id, status: 'pass' });

      continue;
    }

    let secondary;

    try {
      secondary = outcome.secondary();
    } catch (error) {
      results.push({ id: testCase.id, status: 'fail', reason: `threw while rehydrating: ${error?.message ?? String(error)}` });

      continue;
    }

    results.push(
      compare(secondary.expected, secondary.actual, testCase.tolerance)
        ? { id: testCase.id, status: 'pass' }
        : { id: testCase.id, status: 'fail', reason: secondary.reason, expected: secondary.expected, actual: secondary.actual },
    );
  }

  return results;
}

/**
 * Run every requested suite and return one report document per suite.
 *
 * @param {{ lib: Library, corpus: Corpus, suiteIds?: string[], probe?: string, language?: Language }} options
 * @returns {ReportDocument[]}
 */
export function runCorpus({ lib, corpus, suiteIds, probe = 'faithful', language = LANGUAGE }) {
  return (suiteIds ?? corpus.suiteIds()).map((suiteId) => ({
    corpus_version: corpus.version,
    corpus_digest: corpus.digest(),
    language,
    suite: suiteId,
    probe,
    results: runSuite({ lib, suite: corpus.suite(suiteId), probe, language }),
  }));
}

/**
 * The failing case ids per suite, which is what a probe is measured on.
 *
 * @param {ReportDocument[]} documents
 * @returns {Record<string, string[]>}
 */
export function failuresBySuite(documents) {
  /** @type {Record<string, string[]>} */
  const failures = {};

  for (const document of documents) {
    const ids = document.results.filter((result) => result.status === 'fail').map((result) => result.id);

    if (ids.length > 0) failures[document.suite] = ids;
  }

  return failures;
}

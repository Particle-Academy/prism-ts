// prism.ts — the TypeScript member of the Prism agent team.
//
// It reasons by calling prism-ts itself. That is the whole point: an agent
// built on this port is the port's most demanding consumer, and every defect
// it trips over is one a user would have tripped over. An agent that reasoned
// through some other SDK would test nothing.
//
// Zero runtime dependencies, like the package it lives in.

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { Prism, registeredProviders } from '../dist/index.js';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const LANGUAGE = 'ts';
// Provider and model are BOTH configurable, and the provider is checked
// against what this build actually registers. Without that, pointing
// PRISM_AGENT_MODEL at a Claude model would send a Claude model name to
// OpenAI and fail at the API with an error about the model rather than about
// the provider — the confusing kind, that sends you looking in the wrong place.
const PROVIDER = process.env.PRISM_AGENT_PROVIDER ?? 'openai';
const MODEL = process.env.PRISM_AGENT_MODEL ?? 'gpt-4.1-mini';

/** Whether this build can actually route to the configured provider. */
function providerAvailable() {
  return registeredProviders().includes(PROVIDER);
}

/** Long enough for a real suite, bounded so a hung child cannot wedge the lane. */
const RUN_TIMEOUT_MS = Number(process.env.PRISM_AGENT_RUN_TIMEOUT_MS ?? 300_000);

async function packageVersion() {
  try {
    return JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Run an npm script and hand back both streams.
 *
 * Never throws on a non-zero exit. A failing suite is the ANSWER to
 * `run_tests`, not an error in asking — collapsing the two would make a red
 * suite indistinguishable from a broken agent.
 */
async function npmScript(script) {
  try {
    const { stdout, stderr } = await run('npm', ['run', script], {
      cwd: ROOT,
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error.message ?? error),
      timedOut: error.killed === true,
    };
  }
}

/** Last N lines — enough to diagnose, not so much that it floods a context. */
function tail(text, lines = 40) {
  return text.split('\n').slice(-lines).join('\n').trim();
}

export const tools = {
  status: {
    description:
      'Report this agent\'s language, the port version it is running, and whether it can reason. Cheap; safe to poll.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      return {
        language: LANGUAGE,
        agent: 'prism.ts',
        port_version: await packageVersion(),
        provider: PROVIDER,
        model: MODEL,
        providers_available: [...registeredProviders()],
        // A configured provider this build cannot route to is a broken lane
        // that would otherwise look healthy until the first billable call.
        provider_available: providerAvailable(),
        // Named, never returned. Whether a key EXISTS is a status question;
        // what it is never is.
        can_reason: Boolean(process.env.OPENAI_API_KEY),
      };
    },
  },

  describe_port: {
    description:
      'What this port actually implements — providers, and the public API surface. Read from the source, not remembered. Call this before reasoning about whether a feature exists here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      // Facts, from disk. The agent was confidently wrong about a provider it
      // had never had, because nothing let it check — it reasoned from the
      // question it was asked instead of from the port it lives in.
      const providers = await readdir(resolve(ROOT, 'src/providers'), { withFileTypes: true })
        .then(entries => entries.filter(e => e.isDirectory()).map(e => e.name).sort())
        .catch(() => []);

      const exports = await readFile(resolve(ROOT, 'src/index.ts'), 'utf8')
        .then(index =>
          [...index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)]
            .flatMap(m => m[1].split(','))
            .map(name => name.trim().split(/\s+as\s+/)[0].trim())
            .filter(Boolean)
            .sort()
        )
        .catch(() => []);

      return {
        language: LANGUAGE,
        providers_implemented: providers,
        provider_count: providers.length,
        public_exports: [...new Set(exports)],
        note: 'A provider absent from providers_implemented is not implemented here at all — not merely missing a field.',
      };
    },
  },

  run_conformance: {
    description:
      'Run the cross-language conformance suite for TypeScript and return the report document unchanged.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const result = await npmScript('conformance');

      // The runner writes the report document as JSON on stdout. Returned as
      // it comes: the corpus contract is versioned and shared, and reshaping
      // it here is exactly the drift prism-parity exists to prevent.
      const line = result.stdout.trim().split('\n').filter(Boolean).pop() ?? '';

      try {
        return { ok: result.ok, report: JSON.parse(line) };
      } catch {
        return {
          ok: false,
          report: null,
          reason: 'the conformance runner did not emit a parseable report',
          output: tail(result.stderr || result.stdout),
        };
      }
    },
  },

  run_tests: {
    description: 'Run this port\'s own test suite. Returns pass/fail and the tail of the output.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const result = await npmScript('test');
      return {
        passed: result.ok,
        timed_out: result.timedOut === true,
        output: tail(result.stderr || result.stdout),
      };
    },
  },

  explain: {
    description:
      'Reason about a failure in this language and propose a fix. Slow and billable — call it for a specific failure, not for a whole run.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'What failed — a case id, a test name, or a short description.' },
        expected: { type: 'string' },
        actual: { type: 'string' },
        context: { type: 'string', description: 'Anything else that would help: source, corpus entry, prior findings.' },
      },
      required: ['subject'],
      additionalProperties: false,
    },
    async handler({ subject, expected = '', actual = '', context = '' }) {
      if (!providerAvailable()) {
        return {
          ok: false,
          reason:
            `this port does not implement "${PROVIDER}" — it registers: ${registeredProviders().join(', ')}. ` +
            'Set PRISM_AGENT_PROVIDER to one of those, or add the provider to the port.',
        };
      }

      if (!process.env.OPENAI_API_KEY) {
        // Say so rather than calling with an empty bearer token and returning
        // whatever the provider says about it.
        return { ok: false, reason: 'no OPENAI_API_KEY set for this agent — it cannot reason' };
      }

      const response = await Prism.text()
        .using(PROVIDER, MODEL)
        .withSystemPrompt(
          'You are prism.ts, the TypeScript member of the Prism agent team. Prism is a provider-agnostic LLM ' +
            'library ported across PHP, TypeScript and Python; the ports must behave identically for the same input. ' +
            'You are given a failure in the TypeScript port. Explain the actual cause, say whether it is a TypeScript ' +
            'defect or a genuine cross-language disagreement, and propose the smallest fix. If the evidence does not ' +
            'support a conclusion, say what is missing instead of guessing.'
        )
        .withPrompt(
          [
            `Subject: ${subject}`,
            expected && `Expected: ${expected}`,
            actual && `Actual: ${actual}`,
            context && `Context:\n${context}`,
          ]
            .filter(Boolean)
            .join('\n\n')
        )
        .withMaxTokens(900)
        .asText();

      return {
        ok: true,
        language: LANGUAGE,
        analysis: response.text,
        model: response.meta.model,
        tokens: {
          prompt: response.usage.promptTokens ?? null,
          completion: response.usage.completionTokens ?? null,
        },
      };
    },
  },
};

// An END-TO-END exercise of prism-harness-ts, run against a real disk.
//
// The point is dogfooding, not demonstration. The harness's own suite proves
// its pieces; this proves the assembled package works OUTSIDE its own repo, in
// a process that did not write it, reached over the wire by the Lab. Those are
// different claims, and only the second one is what a consumer experiences.
//
// FREE AND DETERMINISTIC, deliberately. The model is a scripted client rather
// than a provider call: what is under test here is the session, the thread, the
// budget and the approval gate, none of which involve a provider — and a probe
// that costs money is a probe nobody runs. The agent reasons through a real
// provider elsewhere; this is the part that does not need one.
//
// Written to a TEMPORARY directory that is removed afterwards, so polling the
// Lab board does not accumulate state on disk.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Resolved from THIS file, which sits in `agent/`, so the sibling repo is two
// levels up. A bare relative specifier would resolve against the repo root and
// silently miss.
const HARNESS = new URL('../../prism-harness-ts/dist/index.js', import.meta.url).href;

/**
 * Run the scenario and return a trace the board can render.
 *
 * Every step returns what it OBSERVED rather than a boolean, so a failure names
 * which property stopped holding instead of reporting that "the harness broke".
 */
export async function probeHarness() {
  let harness;

  try {
    harness = await import(HARNESS);
  } catch (error) {
    return {
      ok: false,
      reason: 'prism-harness-ts is not built beside this port',
      detail: String(error),
      steps: [],
    };
  }

  const {
    AgentRuntime,
    FileSessionStore,
    MemorySessionStore,
    ModeRegistry,
    PrismHarness,
    ToolRegistry,
    recordApproval,
  } = harness;

  const directory = await mkdtemp(join(tmpdir(), 'prism-harness-probe-'));
  const steps = [];
  const check = (name, observed, expected) =>
    steps.push({ step: name, observed, expected, ok: JSON.stringify(observed) === JSON.stringify(expected) });

  try {
    const modes = new ModeRegistry({
      default: 'chat',
      modes: {
        chat: { system_prompt: 'Be brief.', tools: ['echo'], max_steps: 4 },
        guarded: {
          system_prompt: 'Careful.',
          tools: ['echo'],
          max_steps: 4,
          requires_approval: ['echo'],
        },
      },
    });

    let toolRuns = 0;
    const tools = new ToolRegistry().register({
      name: 'echo',
      handle: (args) => {
        toolRuns += 1;

        return `echoed:${args.value ?? ''}`;
      },
    });

    // The guard the package exists for: an in-memory store is refused for
    // durable state. Checked FIRST, because if it does not hold nothing else
    // here means anything.
    let refused = null;
    try {
      new PrismHarness({
        drivers: { memory: () => new MemorySessionStore() },
        stores: { ephemeral: 'memory', durable: 'memory' },
      }).durableStore();
    } catch (error) {
      refused = error.code;
    }
    check('a volatile store is refused for durable state', refused, 'unsafe_state_configuration');

    const app = new PrismHarness({
      drivers: {
        memory: () => new MemorySessionStore(),
        files: () => new FileSessionStore(directory),
      },
      stores: { ephemeral: 'memory', durable: 'files' },
    });

    const participant = { type: 'App\\Models\\User', id: 7 };
    const session = app.for(participant).session('probe');
    await session.usingMode('guarded');
    await session.usingProvider('anthropic');
    await session.usingModel('claude-sonnet-4-5');

    // The same address PHP builds. This is the claim that lets all three
    // languages share one store, so it is asserted rather than described.
    check('the session key matches the reference format', session.key(), 'session:23bd5c8949f6:7:probe');

    let turn = 0;
    const runtime = new AgentRuntime({
      modes,
      tools,
      client: async () => {
        turn += 1;

        return turn <= 2
          ? {
              text: '',
              finishReason: 'tool_calls',
              toolCalls: [{ id: 'call-1', name: 'echo', arguments: { value: 'hello' } }],
            }
          : { text: 'All done.', finishReason: 'stop' };
      },
    });

    const first = await runtime.send(session, 'Say hello with the tool');

    check('a gated tool STOPS the run instead of running', first.finishReason, 'awaiting_approval');
    check('the gated tool did not execute', toolRuns, 0);
    check('the approval request is pending', first.pendingApprovals.map((a) => a.tool), ['echo']);

    // The decision is durable: written to the thread, which lives in the file
    // store, so a different process would read the same answer.
    await recordApproval(session, 'call-1', true);

    const resumed = await runtime.send(session, '');

    check('the tool runs once the approval is recorded', toolRuns, 1);
    check('the resumed turn completes', resumed.text, 'All done.');

    // A SECOND session object over the same stores — the "resolved, never held"
    // property. This is what a fresh worker sees.
    const reopened = app.for(participant).session('probe');

    check('a fresh session sees the same mode', await reopened.mode(), 'guarded');
    check('a fresh session sees the whole conversation', (await reopened.thread().count()) > 0, true);

    const run = await reopened.run();
    check('the run is recorded as completed', run?.status, 'completed');
    check('the run records tool NAMES only', run?.tool_calls, ['echo']);
    check(
      'no tool arguments are recorded on the run',
      JSON.stringify(run ?? {}).includes('hello'),
      false,
    );

    return {
      ok: steps.every((step) => step.ok),
      language: 'ts',
      package: '@particle-academy/prism-harness',
      session_key: session.key(),
      thread_messages: await reopened.thread().count(),
      steps,
    };
  } catch (error) {
    return { ok: false, reason: 'the probe threw', detail: String(error), steps };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

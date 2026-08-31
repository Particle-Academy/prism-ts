import { describe, expect, it } from 'vitest';
import { tools } from '../agent/agent.mjs';

/**
 * The tools this port's agent exposes.
 *
 * Asserted HERE rather than discovered by a consumer. prism-labs was the only
 * thing that ever called these servers, so a dropped or renamed tool would have
 * surfaced as a red banner on a Lab screen and nowhere else — which is exactly
 * how the missing `benchmark` tool stayed invisible until someone screenshotted
 * a preflight failure. See the port gaps register, G-10 and G-11.
 *
 * It earned its place on the first run. The source defines SIX tools; a live
 * probe of the running agent on 2026-08-31 returned five — the server had been
 * started from an older build and nobody could tell, because the only thing
 * asking it was a Lab screen that reports what it is told. A test over the
 * source cannot catch a stale process, but it does establish which list is the
 * intended one, so the two can be compared at all.
 */
describe('agent contract', () => {
  it('exposes exactly the tools the ecosystem expects', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'consensus',
      'describe_port',
      'explain',
      'run_conformance',
      'run_tests',
      'status',
    ]);
  });

  it('does not yet expose benchmark, and that is a tracked gap', () => {
    // G-10. Deliberately asserted rather than left absent: when a lane-execution
    // contract exists and this tool is added, THIS test fails and forces the
    // register entry to be closed in the same change.
    expect(Object.keys(tools)).not.toContain('benchmark');
  });

  it('gives every tool a description and an input schema', () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description, `${name} has no description`).toBeTruthy();
      expect(tool.inputSchema, `${name} has no input schema`).toBeTruthy();
    }
  });
});

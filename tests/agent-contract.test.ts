import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { LOADED_DIGEST, digestOf, tools } from '../agent/agent.mjs';

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

  it('reports capabilities, not just a list of exported type names', async () => {
    // The agent was once confidently wrong about a provider it had never had,
    // because nothing let it check. An export list has the same failure mode
    // for capabilities: it invites inference from type names.
    const described = await tools.describe_port.handler({});

    expect(described.capabilities_implemented).toEqual([
      'audio',
      'batch',
      'embeddings',
      'files',
      'images',
      'moderation',
      'structured',
      'text',
    ]);
    expect(described.providers_implemented).toEqual(['anthropic', 'openai']);
  });

  it('reports whether this process is running the code on disk', async () => {
    // G-12. The running server is the one thing a test over the source cannot
    // check: a server started before a tool was added keeps serving the old
    // list, and the only consumer is a Lab screen that reports what it is told.
    // This is the agent answering the question itself.
    const reported = await tools.status.handler({});

    expect(reported.agent_source_digest).toBeTruthy();
    expect(reported.agent_stale).toBe(false);
  });

  it('computes a digest that actually changes with the file', () => {
    // Otherwise `agent_stale` is a field that always says "fine". A const
    // module binding cannot be reassigned from here, so the comparison is
    // proven through the function it uses.
    expect(digestOf(resolve(import.meta.dirname, '../agent/agent.mjs'))).toBe(LOADED_DIGEST);
    expect(digestOf(resolve(import.meta.dirname, '../agent/server.mjs'))).not.toBe(LOADED_DIGEST);
    expect(digestOf(resolve(import.meta.dirname, '../agent/nope.mjs'))).toBeNull();
  });

  it('separates entry points from provider operations', async () => {
    // They are different lists and only the second is what the parity manifest
    // counts: `stream` is a terminal on the text builder and the audio pair are
    // terminals on `audio`. An agent comparing eight entry points against the
    // manifest's twelve would report a gap that is not there.
    const { provider_operations: operations } = await tools.describe_port.handler({});

    for (const name of ['stream', 'textToSpeech', 'speechToText']) {
      expect(operations, `${name} missing from provider_operations`).toContain(name);
    }

    // G-14: fim is Mistral-only in the reference and no port has Mistral.
    expect(operations).not.toContain('fim');
  });
});

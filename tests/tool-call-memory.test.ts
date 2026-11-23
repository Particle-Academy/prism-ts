import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = new URL('../dist/index.js', import.meta.url).href;

// A hard limit on the heap of a separate process: the engine either fits or
// exits, so the result does not depend on when a collection happens to run.
const HEAP_LIMIT_MB = 44;

const SCRIPT = `
  globalThis.fetch = () => { throw new Error('A test tried to use the network.'); };
  const { ToolCall } = await import(${JSON.stringify(DIST)});
  const text = '{"a":[' + '0,'.repeat(999999) + '0]}';
  console.log(JSON.stringify({ malformed: new ToolCall('c', 't', text).hasMalformedArguments() }));
`;

describe('a long argument list', () => {
  it('is checked inside a bounded heap', () => {
    const run = spawnSync(
      process.execPath,
      [`--max-old-space-size=${HEAP_LIMIT_MB}`, '--input-type=module', '-e', SCRIPT],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 60_000 },
    );

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.trim())).toEqual({ malformed: false });
  }, 70_000);
});

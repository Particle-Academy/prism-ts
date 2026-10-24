import { describe, expect, it } from 'vitest';
import { violations } from '../conformance/stream.mjs';

const properties = { text: 'Hé', normal_completion: true, error_observable: false, terminal_events: 1, no_completed_tools: true, usage_known: false };
const trace = () => ({
  events: [
    { type: 'text_start', payload: {} },
    { type: 'text_delta', payload: { delta: 'Hé' } },
    { type: 'text_complete', payload: { text: 'Hé' } },
    { type: 'stream_end', payload: { finish_reason: 'stop', usage: null } },
  ],
  terminal: { status: 'returned' }, requests: 1,
});

describe('semantic properties remain strict across registered shape divergence', () => {
  it('accepts completed text with unknown accounting', () => {
    expect(violations(trace(), properties)).toEqual([]);
  });

  it('rejects unclosed text even when every delta survived', () => {
    const actual = trace();
    actual.events = actual.events.filter(event => event.type !== 'text_complete');
    expect(violations(actual, properties)).toContain('text_completion');
  });

  it('requires Error rather than any non-Stop finish for a failed stream', () => {
    const actual = trace();
    actual.events.unshift({ type: 'error', payload: {} });
    actual.events.at(-1)!.payload.finish_reason = 'unknown';
    expect(violations(actual, { ...properties, normal_completion: false, error_observable: true })).toContain('normal_completion');
  });
});

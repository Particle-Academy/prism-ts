import { afterEach, expect, it, vi } from 'vitest';
import { StreamStartEvent, TextDeltaEvent } from '../src/index.js';

afterEach(() => { vi.restoreAllMocks(); });

it('uses Unix seconds for default event timestamps while retaining explicit timestamps', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_123_987);
  expect(new StreamStartEvent('fixture').toObject().timestamp).toBe(1_800_000_123);
  expect(new StreamStartEvent('fixture', 'fixed', 0).toObject().timestamp).toBe(0);
  expect(new TextDeltaEvent('message', 'text', 'fixed', 123).toObject().timestamp).toBe(123);
});

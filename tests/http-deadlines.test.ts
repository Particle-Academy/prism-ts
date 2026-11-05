import { afterEach, expect, it, vi } from 'vitest';
import { fetchBinaryTransport, fetchStreamTransport, fetchTransport } from '../src/http/transport.js';
import type { HttpRequest } from '../src/http/transport.js';
import { DEFAULT_REQUEST_TIMEOUT, DEFAULT_STREAM_IDLE_TIMEOUT } from '../src/http/deadline.js';
import { Image } from '../src/index.js';

const request: HttpRequest = { url: 'https://offline.invalid/', method: 'POST', headers: {}, body: '{}', clientOptions: {} };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('ships 30-second requests and 60-second stream-idle limits', () => {
  expect(DEFAULT_REQUEST_TIMEOUT).toBe(30);
  expect(DEFAULT_STREAM_IDLE_TIMEOUT).toBe(60);
});

it.each([fetchTransport, fetchBinaryTransport])('bounds headers and nonstream bodies by the same total deadline', async (transport) => {
  vi.useFakeTimers();
  const body = new ReadableStream<Uint8Array>();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  const result = transport(request);
  const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(30_000);
  await failure;
  expect(vi.getTimerCount()).toBe(0);
});

it('honors explicit signals during a nonstream body', async () => {
  const caller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>())));
  const result = fetchTransport({ ...request, clientOptions: { signal: caller.signal } });
  const failure = expect(result).rejects.toBe('caller cancellation');
  caller.abort('caller cancellation');
  await failure;
});

it('clears the header timer and never installs an overall stream deadline', async () => {
  vi.useFakeTimers();
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { output = controller; }, cancel }))));
  const response = await fetchStreamTransport(request);
  await vi.advanceTimersByTimeAsync(90_000);
  output.enqueue(new TextEncoder().encode('alive'));
  const iterator = response.chunks[Symbol.asyncIterator]();
  expect(await iterator.next()).toEqual({ value: 'alive', done: false });
  expect(vi.getTimerCount()).toBe(0);
  await iterator.return?.();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('times out a pending stream read after 60 idle seconds and cancels the body', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))));
  const response = await fetchStreamTransport(request);
  const iterator = response.chunks[Symbol.asyncIterator]();
  const failure = expect(iterator.next()).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(60_000);
  await failure;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('retains explicit cancellation through a stream body', async () => {
  const caller = new AbortController();
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))));
  const response = await fetchStreamTransport({ ...request, clientOptions: { signal: caller.signal } });
  const failure = expect(response.chunks[Symbol.asyncIterator]().next()).rejects.toBe('caller cancellation');
  caller.abort('caller cancellation');
  await failure;
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('refuses a pre-aborted caller before any network dispatch', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(fetchTransport({ ...request, clientOptions: { signal: AbortSignal.abort('already cancelled') } })).rejects.toBe('already cancelled');
  expect(fetch).not.toHaveBeenCalled();
});

it('closes an unstarted body iterator', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))));
  const response = await fetchStreamTransport(request);
  await response.chunks[Symbol.asyncIterator]().return?.();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('does not turn a large valid timeout into an immediate timer', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  expect((await fetchTransport({ ...request, clientOptions: { timeout: 3_000_000 } })).status).toBe(200);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels rejected media bodies without consuming them or exposing URL credentials', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 403 })));
  const result = Image.fromUrl('https://user:private@offline.invalid/file?token=secret').fetch();
  await expect(result).rejects.toThrow('responded 403');
  await expect(result).rejects.not.toThrow('private');
  await expect(result).rejects.not.toThrow('secret');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

it('does not wait for a rejected media body to acknowledge cancellation', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 403 })));
  await expect(Image.fromUrl('https://offline.invalid/file').fetch()).rejects.toThrow('responded 403');
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('keeps guarded redirect body cleanup inside the total deadline', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 302, headers: { location: '/next' } }));
  vi.stubGlobal('fetch', fetch);
  const result = Image.fromUrl('https://offline.invalid/file').fetchPublic({ resolver: { resolve: () => ['93.184.216.34'] }, timeout: 0.1 });
  const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(100);
  await failure;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('honors a per-request read timeout through a stalled cancellation acknowledgement', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))));
  const response = await fetchStreamTransport({ ...request, clientOptions: { read_timeout: 0.25 } });
  let observed: unknown;
  const pending = response.chunks[Symbol.asyncIterator]().next().catch(error => { observed = error; });
  await vi.advanceTimersByTimeAsync(249);
  expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(observed).toMatchObject({ name: 'TimeoutError' });
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});

it('allows a disabled idle limit without disabling caller cancellation', async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))));
  const response = await fetchStreamTransport({ ...request, clientOptions: { read_timeout: 0, signal: caller.signal } });
  let observed: unknown;
  const pending = response.chunks[Symbol.asyncIterator]().next().catch(error => { observed = error; });
  await vi.advanceTimersByTimeAsync(90_000);
  expect(cancel).not.toHaveBeenCalled();
  caller.abort('stop');
  await vi.advanceTimersByTimeAsync(0);
  expect(observed).toBe('stop');
  await pending;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('closes an unstarted iterator without waiting for cancellation acknowledgement', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))));
  const response = await fetchStreamTransport(request);
  let returned = false;
  const pending = response.chunks[Symbol.asyncIterator]().return?.().then(() => { returned = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(returned).toBe(true);
  await pending;
});

it('validates an idle timeout before network dispatch or installing timers', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(fetchStreamTransport({ ...request, clientOptions: { read_timeout: -1 } })).rejects.toThrow(RangeError);
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

/** Durations are seconds; event timestamps use a separate Unix-seconds contract. */
export const DEFAULT_REQUEST_TIMEOUT = 30;
export const DEFAULT_STREAM_IDLE_TIMEOUT = 60;

export function timeoutSeconds(value: unknown, fallback = DEFAULT_REQUEST_TIMEOUT): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError('Timeout must be finite nonnegative seconds.');
  }
  return value;
}

export class RequestDeadline {
  readonly #controller = new AbortController();
  readonly signal: AbortSignal;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(seconds: number, caller?: AbortSignal | null) {
    this.signal = caller === null || caller === undefined ? this.#controller.signal : AbortSignal.any([caller, this.#controller.signal]);
    this.arm(seconds);
  }

  arm(seconds: number): void {
    this.clear();
    if (seconds > 0) {
      // Node clamps an overflowing delay to 1 ms. Schedule long durations in
      // safe portions rather than turning a generous caller override into 1 ms.
      const milliseconds = seconds * 1000;
      const portion = Math.min(milliseconds, 2_147_483_647);
      this.#timer = setTimeout(() => {
        if (milliseconds > portion) this.arm((milliseconds - portion) / 1000);
        else this.#controller.abort(new DOMException('Prism request timed out.', 'TimeoutError'));
      }, portion);
    }
  }

  clear(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

/** Also honors cancellation for consumer-supplied fetch stubs and resolvers. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => { reject(signal.reason); };
    // Always attach handlers, even if already aborted, so a rejected operation
    // cannot become an unhandled rejection after the caller has left.
    promise.then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

export async function withRequestDeadline<T>(options: Readonly<Record<string, unknown>>, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new RequestDeadline(timeoutSeconds(options.timeout), options.signal as AbortSignal | null | undefined);
  try {
    deadline.signal.throwIfAborted();
    return await abortable(work(deadline.signal), deadline.signal);
  } finally {
    deadline.clear();
  }
}

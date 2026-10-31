export interface DelayPoolOptions<T> {
  items: readonly T[];
  run: (item: T, index: number) => Promise<unknown>;
  onBatch: (indices: number[]) => void;
  onError?: (error: unknown, item: T, index: number) => void;
  concurrency?: number;
  flushMs?: number;
  signal?: AbortSignal;
}

/**
 * Run URL tests with FlClash's 32-way pool and flush UI updates every 300ms.
 * Individual failures do not stop the pool; the caller decides whether a
 * failure is fatal.
 */
export function runDelayPool<T>({
  items,
  run,
  onBatch,
  onError,
  concurrency = 32,
  flushMs = 300,
  signal,
}: DelayPoolOptions<T>): Promise<void> {
  return new Promise((resolve) => {
    let next = 0;
    let active = 0;
    let completed = 0;
    let closed = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pending: number[] = [];

    const flush = () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pending.length === 0) {
        return;
      }
      const batch = pending.splice(0, pending.length);
      onBatch(batch);
    };

    const scheduleFlush = () => {
      if (flushTimer === null) {
        flushTimer = setTimeout(flush, flushMs);
      }
    };

    const finishIfDone = () => {
      if (completed === items.length && !closed) {
        closed = true;
        flush();
        resolve();
      }
    };

    const pump = () => {
      if (closed) {
        return;
      }
      if (signal?.aborted) {
        closed = true;
        flush();
        resolve();
        return;
      }
      while (active < concurrency && next < items.length) {
        const index = next;
        next += 1;
        active += 1;
        const item = items[index];
        run(item, index)
          .catch((error: unknown) => {
            onError?.(error, item, index);
          })
          .finally(() => {
            active -= 1;
            completed += 1;
            pending.push(index);
            scheduleFlush();
            finishIfDone();
            pump();
          });
      }
      if (next >= items.length && active === 0) {
        finishIfDone();
      }
    };

    pump();
  });
}

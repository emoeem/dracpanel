import { describe, expect, it, vi } from "vitest";

import { runDelayPool } from "./delayPool";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("runDelayPool", () => {
  it("runs every item despite individual failures", async () => {
    const ran: number[] = [];
    const batches: number[][] = [];
    await runDelayPool({
      items: [0, 1, 2, 3],
      run: async (item) => {
        ran.push(item);
        if (item === 1) {
          throw new Error("boom");
        }
      },
      onBatch: (batch) => batches.push([...batch]),
      onError: () => {},
      flushMs: 1,
    });
    expect(ran.sort()).toEqual([0, 1, 2, 3]);
    expect(batches.flat().sort()).toEqual([0, 1, 2, 3]);
  });

  it("respects the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const gate = deferred<void>();
    const items = Array.from({ length: 10 }, (_, index) => index);
    const promise = runDelayPool({
      items,
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      },
      onBatch: () => {},
      concurrency: 3,
      flushMs: 1,
    });
    await vi.waitFor(() => {
      expect(peak).toBe(3);
    });
    gate.resolve();
    await promise;
    expect(peak).toBe(3);
  });

  it("aborts without resolving the rest", async () => {
    const controller = new AbortController();
    const completed: number[] = [];
    const promise = runDelayPool({
      items: [0, 1, 2],
      run: async (item) => {
        if (item === 0) {
          controller.abort();
          completed.push(item);
          return;
        }
        // Never reached: the abort stops the pump before later items start.
        completed.push(item);
      },
      onBatch: () => {},
      signal: controller.signal,
      concurrency: 1,
      flushMs: 1,
    });
    await promise;
    expect(completed).toEqual([0]);
  });
});

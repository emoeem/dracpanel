import { describe, expect, it } from "vitest";

import {
  emptyThrottle,
  LOGIN_LOCK_MS,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  recordFailure,
  throttleLockRemaining,
} from "./loginThrottle";

const T0 = 1_700_000_000_000;

/** Retries land close together, so model them all at `start`. */
function failMany(count: number, start = T0): ReturnType<typeof emptyThrottle> {
  let state = emptyThrottle();
  for (let index = 0; index < count; index += 1) {
    state = recordFailure(state, start);
  }
  return state;
}

describe("recordFailure", () => {
  it("accumulates failures inside the window", () => {
    const state = failMany(LOGIN_MAX_FAILURES - 1);
    expect(state.failures).toHaveLength(LOGIN_MAX_FAILURES - 1);
    expect(throttleLockRemaining(state, T0)).toBe(0);
  });

  it("locks once the window budget is exhausted", () => {
    const state = failMany(LOGIN_MAX_FAILURES);
    expect(throttleLockRemaining(state, T0)).toBe(LOGIN_LOCK_MS);
    expect(state.failures).toHaveLength(0);
  });

  it("drops failures that aged out of the window", () => {
    let state = failMany(LOGIN_MAX_FAILURES - 1);
    // Wait out the whole window, then fail once: only the new one counts.
    state = recordFailure(state, T0 + LOGIN_WINDOW_MS);
    expect(state.failures).toHaveLength(1);
    expect(throttleLockRemaining(state, T0 + LOGIN_WINDOW_MS)).toBe(0);
  });
});

describe("throttleLockRemaining", () => {
  it("is zero once the lock expires", () => {
    const state = failMany(LOGIN_MAX_FAILURES);
    expect(throttleLockRemaining(state, T0 + LOGIN_LOCK_MS)).toBe(0);
    expect(throttleLockRemaining(state, T0 + LOGIN_LOCK_MS - 1)).toBe(1);
  });

  it("does not extend an active lock", () => {
    const locked = failMany(LOGIN_MAX_FAILURES);
    const later = T0 + 60_000;
    const again = recordFailure(locked, later);
    expect(again).toBe(locked);
    expect(throttleLockRemaining(again, later)).toBe(LOGIN_LOCK_MS - 60_000);
  });
});

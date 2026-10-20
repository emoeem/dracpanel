// Rate limiting for the panel token gate. Without this, the gate can be
// brute-forced: a wrong token only ever re-renders a message, with no cost to
// the caller. Failure counts live in preference storage so a reload does not
// hand back a fresh budget.
import { loadStoredJson, removeStoredValue, saveStoredJson } from "../lib/storage";

const STORAGE_KEY = "panel_login_throttle";

export const LOGIN_WINDOW_MS = 5 * 60_000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60_000;

export interface LoginThrottle {
  /** Timestamps of failed attempts inside the current window. */
  failures: number[];
  /** Epoch ms until which the gate stays locked; 0 when unlocked. */
  lockedUntil: number;
}

export function emptyThrottle(): LoginThrottle {
  return { failures: [], lockedUntil: 0 };
}

export function throttleLockRemaining(state: LoginThrottle, now: number): number {
  return state.lockedUntil > now ? state.lockedUntil - now : 0;
}

export function recordFailure(state: LoginThrottle, now: number): LoginThrottle {
  // A caller that keeps guessing while locked must not push its own lock out.
  if (throttleLockRemaining(state, now) > 0) {
    return state;
  }
  const failures = [...state.failures.filter((at) => now - at < LOGIN_WINDOW_MS), now];
  if (failures.length < LOGIN_MAX_FAILURES) {
    return { failures, lockedUntil: 0 };
  }
  return { failures: [], lockedUntil: now + LOGIN_LOCK_MS };
}

function parse(value: unknown): LoginThrottle {
  if (typeof value !== "object" || value === null) {
    return emptyThrottle();
  }
  const raw = value as { failures?: unknown; lockedUntil?: unknown };
  const failures = Array.isArray(raw.failures)
    ? raw.failures.filter((at): at is number => typeof at === "number")
    : [];
  const lockedUntil = typeof raw.lockedUntil === "number" ? raw.lockedUntil : 0;
  return { failures, lockedUntil };
}

export function readLoginThrottle(): LoginThrottle {
  return parse(loadStoredJson(STORAGE_KEY));
}

/** Records a failed attempt and returns the resulting state. */
export function noteLoginFailure(now: number = Date.now()): LoginThrottle {
  const next = recordFailure(readLoginThrottle(), now);
  if (next.failures.length === 0 && next.lockedUntil === 0) {
    removeStoredValue(STORAGE_KEY);
  } else {
    saveStoredJson(STORAGE_KEY, next);
  }
  return next;
}

export function clearLoginThrottle(): void {
  removeStoredValue(STORAGE_KEY);
}

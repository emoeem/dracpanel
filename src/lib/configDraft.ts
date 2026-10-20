/**
 * Local safety net for the config editor.
 *
 * The JSON editor holds the whole sing-box config, and a reload (or a lost
 * token) throws that away. We keep two things in browser storage:
 *
 * - a *draft*: the latest unsaved text, so a reload can offer to bring it back;
 * - a *last applied* snapshot: the text that actually reached the daemon, so a
 *   bad edit can be rolled back to something known to work.
 *
 * The undo stack itself stays in memory — 40 copies of a config would blow the
 * storage budget for very little benefit.
 */

import { loadStoredJson, removeStoredValue, saveStoredJson } from "./storage";

export const CONFIG_DRAFT_KEY = "panel-config-draft";
export const LAST_APPLIED_KEY = "panel-config-applied";

/** Drafts older than this are almost certainly abandoned. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const UNDO_LIMIT = 40;

/** Keystrokes closer together than this collapse into one undo step. */
export const UNDO_COALESCE_MS = 700;

export interface ConfigDraft {
  text: string;
  /** The server text the draft was started from, used to detect drift. */
  base: string;
  savedAt: number;
}

export interface AppliedSnapshot {
  text: string;
  appliedAt: number;
}

function readPair(value: unknown): { text: unknown; other: unknown; at: unknown } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { text?: unknown; base?: unknown; savedAt?: unknown; appliedAt?: unknown };
  return { text: record.text, other: record.base ?? record.appliedAt, at: record.savedAt ?? record.appliedAt };
}

export function normalizeDraft(value: unknown, now: number): ConfigDraft | null {
  const pair = readPair(value);
  if (pair === null || typeof pair.text !== "string" || typeof pair.other !== "string") {
    return null;
  }
  const savedAt = typeof pair.at === "number" && Number.isFinite(pair.at) ? pair.at : now;
  if (now - savedAt > DRAFT_MAX_AGE_MS || savedAt > now + 60_000) {
    return null;
  }
  return { text: pair.text, base: pair.other, savedAt };
}

export function readConfigDraft(now = Date.now()): ConfigDraft | null {
  return normalizeDraft(loadStoredJson(CONFIG_DRAFT_KEY), now);
}

export function writeConfigDraft(text: string, base: string, now = Date.now()): void {
  const draft: ConfigDraft = { text, base, savedAt: now };
  saveStoredJson(CONFIG_DRAFT_KEY, draft);
}

export function clearConfigDraft(): void {
  removeStoredValue(CONFIG_DRAFT_KEY);
}

export function readLastApplied(now = Date.now()): AppliedSnapshot | null {
  const pair = readPair(loadStoredJson(LAST_APPLIED_KEY));
  if (pair === null || typeof pair.text !== "string") {
    return null;
  }
  const appliedAt = typeof pair.at === "number" && Number.isFinite(pair.at) ? pair.at : now;
  if (appliedAt > now + 60_000) {
    return null;
  }
  return { text: pair.text, appliedAt };
}

export function writeLastApplied(text: string, now = Date.now()): void {
  saveStoredJson(LAST_APPLIED_KEY, { text, appliedAt: now } satisfies AppliedSnapshot);
}

/** A draft is only worth restoring when it differs from what the server holds. */
export function draftIsMeaningful(draft: ConfigDraft | null, serverText: string): boolean {
  return draft !== null && draft.text !== serverText;
}

export function pushUndoEntry(
  stack: readonly string[],
  entry: string,
  limit = UNDO_LIMIT,
): string[] {
  if (stack[stack.length - 1] === entry) {
    return [...stack];
  }
  const next = [...stack, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function undoTop(stack: readonly string[]): { text: string | null; stack: string[] } {
  if (stack.length === 0) {
    return { text: null, stack: [...stack] };
  }
  return { text: stack[stack.length - 1], stack: stack.slice(0, -1) };
}

export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.round(hours / 24)} 天前`;
}

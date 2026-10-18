import { normalizeConfigJson } from "../api/panel";

export type ConfigChangeKind = "added" | "removed" | "changed";

export interface ConfigChange {
  path: string;
  kind: ConfigChangeKind;
  before?: unknown;
  after?: unknown;
  sensitive: boolean;
}

export interface ConfigDiff {
  changes: ConfigChange[];
  truncated: boolean;
}

export interface ConfigDiffLine {
  kind: "same" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
}

const MAX_CHANGES = 200;
const MAX_LINE_MATRIX = 250_000;

const SENSITIVE_ROOTS = new Set([
  "services",
  "inbounds",
  "outbounds",
  "dns",
  "route",
  "clash_api",
]);

const SENSITIVE_KEYS = new Set([
  "secret",
  "password",
  "username",
  "uuid",
  "token",
  "auth",
  "users",
  "private_key",
  "public_key",
  "short_id",
  "server",
  "server_port",
  "listen",
  "listen_port",
  "tls",
  "reality",
  "obfs",
  "wireguard",
  "peers",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) {
    return true;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return (
      before.length === after.length &&
      before.every((value, index) => deepEqual(value, after[index]))
    );
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    return (
      beforeKeys.length === afterKeys.length &&
      beforeKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(after, key) &&
          deepEqual(before[key], after[key]),
      )
    );
  }
  return false;
}

function joinPath(base: string, key: string | number): string {
  if (typeof key === "number") {
    return `${base}[${key}]`;
  }
  return base === "" ? key : `${base}.${key}`;
}

export function isSensitiveConfigPath(path: string): boolean {
  return path
    .split(/[.[\]]+/)
    .filter(Boolean)
    .some(
      (segment) =>
        SENSITIVE_ROOTS.has(segment) || SENSITIVE_KEYS.has(segment),
    );
}

function pushChange(
  changes: ConfigChange[],
  state: { truncated: boolean },
  change: Omit<ConfigChange, "sensitive">,
): void {
  if (changes.length >= MAX_CHANGES) {
    state.truncated = true;
    return;
  }
  changes.push({
    ...change,
    sensitive: isSensitiveConfigPath(change.path),
  });
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  changes: ConfigChange[],
  state: { truncated: boolean },
): void {
  if (changes.length >= MAX_CHANGES) {
    state.truncated = true;
    return;
  }
  if (deepEqual(before, after)) {
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      walk(
        before[key],
        after[key],
        joinPath(path, key),
        changes,
        state,
      );
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      walk(
        before[index],
        after[index],
        joinPath(path, index),
        changes,
        state,
      );
    }
    return;
  }
  if (before === undefined) {
    pushChange(changes, state, { path, kind: "added", after });
    return;
  }
  if (after === undefined) {
    pushChange(changes, state, { path, kind: "removed", before });
    return;
  }
  pushChange(changes, state, { path, kind: "changed", before, after });
}

/** Parse both configs with sing-box's comment/trailing-comma subset, then diff. */
export function diffConfig(beforeText: string, afterText: string): ConfigDiff {
  const before: unknown = JSON.parse(normalizeConfigJson(beforeText));
  const after: unknown = JSON.parse(normalizeConfigJson(afterText));
  const changes: ConfigChange[] = [];
  const state = { truncated: false };
  walk(before, after, "", changes, state);
  return { changes, truncated: state.truncated };
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "—";
  }
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function diffLines(beforeText: string, afterText: string): ConfigDiffLine[] {
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);

  if (before.length * after.length > MAX_LINE_MATRIX) {
    return [
      ...before.map((text, index) => ({
        kind: "removed" as const,
        text,
        oldLine: index + 1,
      })),
      ...after.map((text, index) => ({
        kind: "added" as const,
        text,
        newLine: index + 1,
      })),
    ];
  }

  const lcs = Array.from({ length: before.length + 1 }, () =>
    new Uint32Array(after.length + 1),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: ConfigDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({
        kind: "same",
        text: before[i],
        oldLine: i + 1,
        newLine: j + 1,
      });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: "removed", text: before[i], oldLine: i + 1 });
      i += 1;
    } else {
      lines.push({ kind: "added", text: after[j], newLine: j + 1 });
      j += 1;
    }
  }
  while (i < before.length) {
    lines.push({ kind: "removed", text: before[i], oldLine: i + 1 });
    i += 1;
  }
  while (j < after.length) {
    lines.push({ kind: "added", text: after[j], newLine: j + 1 });
    j += 1;
  }
  return lines;
}

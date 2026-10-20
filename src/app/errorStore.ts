import { useSyncExternalStore } from "react";

import { describeError } from "../api/stream";
import { reportError } from "../lib/errorReporting";
import { notify } from "../lib/notifier";

let queue: string[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showError(error: unknown, where?: string) {
  reportError(error, { where: where ?? "showError" });
  const message = describeError(error).message;
  if (queue.includes(message)) {
    return;
  }
  queue = [...queue, message];
  emit();
  notify("error", message, where ?? "");
}

export function dismissError() {
  queue = queue.slice(1);
  emit();
}

export function useCurrentError(): string | null {
  return useSyncExternalStore(subscribe, () => queue[0] ?? null);
}

/**
 * Vendor-agnostic error reporting seam.
 *
 * The panel ships with no telemetry SDK and no DSN. Everything is a no-op until
 * a reporter is installed via `setErrorReporter`, which is where a Sentry (or
 * any other) binding belongs once a DSN is available.
 */

export interface ErrorContext {
  /** Where the failure surfaced, e.g. "ErrorBoundary" or "showError". */
  where?: string;
  /** Low-cardinality key/value pairs suitable for grouping. */
  tags?: Record<string, string>;
  /** Arbitrary payload, never sent anywhere unless a reporter is installed. */
  extra?: Record<string, unknown>;
}

export interface ErrorReporter {
  captureException(error: unknown, context?: ErrorContext): void;
  captureMessage(message: string, context?: ErrorContext): void;
}

let reporter: ErrorReporter | null = null;

const listeners = new Set<(reporter: ErrorReporter | null) => void>();

function emit() {
  for (const listener of listeners) {
    listener(reporter);
  }
}

export function setErrorReporter(next: ErrorReporter | null) {
  reporter = next;
  emit();
}

export function getErrorReporter(): ErrorReporter | null {
  return reporter;
}

export function onErrorReporterChange(listener: (reporter: ErrorReporter | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forgets about already reported errors so the same one can be raised again. */
export function resetReportedErrors() {
  seen.clear();
}

const MAX_TRACKED = 200;

const seen = new Set<string>();

function fingerprint(error: unknown, context?: ErrorContext): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${context?.where ?? ""}::${message}`;
}

export function reportError(error: unknown, context?: ErrorContext) {
  const key = fingerprint(error, context);
  if (seen.has(key)) {
    return;
  }
  if (seen.size >= MAX_TRACKED) {
    // Cheap FIFO eviction: the oldest entries are the least likely to recur.
    const oldest = seen.values().next();
    if (oldest.done !== true) {
      seen.delete(oldest.value);
    }
  }
  seen.add(key);

  if (import.meta.env.DEV) {
    console.error("[DracPanel]", context?.where ?? "error", error, context?.extra ?? "");
  }
  reporter?.captureException(error, context);
}

export function reportMessage(message: string, context?: ErrorContext) {
  if (import.meta.env.DEV) {
    console.warn("[DracPanel]", message, context?.extra ?? "");
  }
  reporter?.captureMessage(message, context);
}

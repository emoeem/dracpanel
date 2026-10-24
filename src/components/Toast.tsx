import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "../app/i18n";
import { cx } from "../lib/cx";
import styles from "./Toast.module.css";

export type ToastTone = "info" | "good" | "danger";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const TOAST_DURATION = 4000;

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function ToastProvider(props: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, tone }]);
    const timer = setTimeout(() => dismiss(id), TOAST_DURATION);
    timers.current.set(id, timer);
  }, [dismiss]);

  // Clear any pending auto-dismiss timers if the provider itself unmounts,
  // so we never call setToasts on a detached component.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) {
        clearTimeout(timer);
      }
      map.clear();
    };
  }, []);

  const { t } = useI18n();
  const dismissLabel = t("Dismiss");

  return (
    <ToastContext.Provider value={show}>
      {props.children}
      <div className={styles.stack} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className={cx(styles.toast, styles[toast.tone])}
            title={dismissLabel}
            onClick={() => dismiss(toast.id)}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (show === null) {
    throw new Error("missing toast context");
  }
  return show;
}
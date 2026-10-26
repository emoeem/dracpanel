import { useCallback, useEffect, useRef, useState } from "react";

import { getPanelState, hasPanelToken, type PanelState } from "../api/panel";

export interface PanelStateResult {
  state: PanelState | null;
  /** True once a fetch failed (e.g. the panel backend is unreachable). */
  error: boolean;
  refresh: () => void;
}

/**
 * Polls the panel's `/api/state` at a low frequency for dashboard cards.
 * Polling pauses while the document is hidden and never starts without a
 * panel token (direct mode has no panel, and polling without a token would
 * raise panel-auth-error and bounce the user to the gate).
 */
export function usePanelState(intervalMs = 15_000): PanelStateResult {
  const [state, setState] = useState<PanelState | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (intervalMs <= 0 || !hasPanelToken()) {
      setState(null);
      setError(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const current = await getPanelState();
        if (!cancelled && mounted.current) {
          setState(current);
          setError(false);
        }
      } catch {
        if (!cancelled && mounted.current) {
          setError(true);
        }
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { state, error, refresh };
}

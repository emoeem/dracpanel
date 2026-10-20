import { useEffect, useMemo, useRef } from "react";

export interface AsyncGeneration {
  /** Starts a new round and returns its id. */
  begin(): number;
  /** True while `id` is still the newest round, i.e. safe to commit state. */
  isCurrent(id: number): boolean;
  /** Abandons every in-flight round, e.g. when switching tabs. */
  invalidate(): void;
}

/**
 * Guards async loads against writing state for a stale round: a slow response
 * from a previous tab (or a previous attempt) can no longer overwrite the data
 * the user is currently looking at.
 */
export function useAsyncGeneration(): AsyncGeneration {
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  return useMemo(
    () => ({
      begin: () => (generation.current += 1),
      isCurrent: (id: number) => generation.current === id,
      invalidate: () => {
        generation.current += 1;
      },
    }),
    [],
  );
}

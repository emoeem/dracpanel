import { useEffect, useMemo, useState } from "react";

import type { DaemonApi } from "../api/daemon";
import { useStream } from "../api/stream";
import { RuleHitAccumulator, type RuleHitStats } from "../lib/ruleHits";

export interface RuleHits {
  /** Per-rule counters, busiest first. */
  stats: readonly RuleHitStats[];
  /** Look-up for a single rule key; returns zeroed stats when unseen. */
  get(rule: string): RuleHitStats;
  /** True once at least one connection snapshot has been folded in. */
  observed: boolean;
}

/**
 * Accumulates rule hit counters for the lifetime of the caller.
 *
 * Mounting this hook opens the connection stream, so callers should keep it on
 * a screen that actually shows the numbers (currently the rules view) rather
 * than in the app shell.
 */
export function useRuleHits(api: DaemonApi): RuleHits {
  const snapshot = useStream(api.connections);
  const accumulator = useMemo(() => new RuleHitAccumulator(), []);
  const [stats, setStats] = useState<readonly RuleHitStats[]>([]);
  const [observed, setObserved] = useState(false);
  const rows = snapshot.data.rows;

  useEffect(() => {
    if (!snapshot.data.loaded) {
      return;
    }
    const entries = [...rows].map(
      ([id, row]) =>
        [
          id,
          {
            rule: row.connection.rule,
            uplinkTotal: row.uplinkTotal,
            downlinkTotal: row.downlinkTotal,
            closedAt: row.closedAt,
          },
        ] as const,
    );
    accumulator.ingest(entries, Date.now());
    setStats(accumulator.snapshot());
    setObserved(true);
  }, [accumulator, rows, snapshot.data.loaded]);

  return useMemo(
    () => ({
      stats,
      get: (rule: string) => accumulator.get(rule),
      observed,
    }),
    [accumulator, stats, observed],
  );
}

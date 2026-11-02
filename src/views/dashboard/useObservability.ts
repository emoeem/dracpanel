import { useEffect, useMemo, useRef, useState } from "react";

import { getPanelToken, hasPanelToken } from "../../api/panel";
import type { ConnectionRow } from "../../api/daemon";
import { endpointIp } from "../../lib/connectionTools";

/**
 * Observability data hooks behind the doona-style dashboard cards:
 *  - /api/history for persisted time ranges (needs the panel backend),
 *  - session-level per-outbound and per-host totals derived from the live
 *    connections stream (works in direct mode, reset on page reload),
 *  - the persisted notification feed.
 */

export type HistoryRange = "10m" | "1h" | "6h" | "24h" | "7d";

export interface HistoryPoint {
  t: number;
  up: number;
  down: number;
  out?: Record<string, number>;
}

export interface HistorySummary {
  down_peak: number;
  down_avg: number;
  up_peak: number;
  up_avg: number;
}

export interface HistoryResult {
  range: HistoryRange;
  bucket: number;
  since: number;
  points: HistoryPoint[];
  summary: HistorySummary;
}

/** Fetch /api/history; rejects when the panel backend is unavailable. */
export async function fetchHistory(range: HistoryRange): Promise<HistoryResult> {
  const headers: HeadersInit = {};
  const token = getPanelToken();
  if (token !== "") {
    headers["X-Panel-Token"] = token;
  }
  const response = await fetch(`/api/history?range=${range}`, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as HistoryResult;
}

const HISTORY_REFRESH_MS = 60_000;

/** Persisted range data; null while unavailable (direct mode / no samples). */
export function useHistoryRangeData(range: HistoryRange, enabled = true): HistoryResult | null {
  const [result, setResult] = useState<HistoryResult | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (!hasPanelToken()) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      if (document.hidden) {
        return;
      }
      fetchHistory(range)
        .then((value) => {
          if (!cancelled) {
            setResult(value);
          }
        })
        .catch(() => {
          if (!cancelled && range !== "10m") {
            setResult(null);
          }
        });
    };
    load();
    const timer = window.setInterval(load, HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [range, enabled]);
  return result;
}

interface ConnectionsSnapshot {
  data: { rows: Map<string, ConnectionRow> };
}

/**
 * Session-scope download totals per exit outbound.
 *
 * Deltas come from the per-connection cumulative byte counter, not from
 * `downlinkRate`: the stream only rewrites rows that received an UPDATE event,
 * so an idle row keeps last tick's rate and adding it again every frame
 * double-counts the whole session (the ring chart grew without bound).
 * Comparing cumulative totals is idempotent under repeated snapshots.
 * Reset on page reload by design — persisted history takes over when the
 * panel backend is available.
 */
export function useSessionOutboundTotals(
  connections: ConnectionsSnapshot | null,
): [string, number][] {
  const [totals, setTotals] = useState<Map<string, number>>(() => new Map());
  const accumulator = useRef<Map<string, number>>(new Map());
  const seen = useRef<Map<string, bigint>>(new Map());
  const rows = connections?.data.rows;

  useEffect(() => {
    if (!rows) {
      return;
    }
    let changed = false;
    for (const [id, row] of rows) {
      const total = row.downlinkTotal;
      const previous = seen.current.get(id);
      seen.current.set(id, total);
      // First sighting only records a baseline: traffic that happened before
      // the panel opened is not part of this session.
      if (previous === undefined || total <= previous) {
        continue;
      }
      const delta = Number(total - previous);
      if (!Number.isFinite(delta) || delta <= 0) {
        continue;
      }
      const tag = row.connection.outbound || "direct";
      accumulator.current.set(tag, (accumulator.current.get(tag) ?? 0) + delta);
      changed = true;
    }
    if (seen.current.size > rows.size) {
      for (const id of seen.current.keys()) {
        if (!rows.has(id)) {
          seen.current.delete(id);
        }
      }
    }
    if (changed) {
      setTotals(new Map(accumulator.current));
    }
  }, [rows]);

  return useMemo(
    () => [...totals.entries()].sort((left, right) => right[1] - left[1]),
    [totals],
  );
}

/** 设备/域名排行：当前快照的下行总量聚合（会话级）。 */
export function useSessionRanking(
  rows: readonly ConnectionRow[] | null,
  key: "device" | "host",
): [string, number][] {
  return useMemo(() => {
    if (!rows) {
      return [];
    }
    const totals = new Map<string, number>();
    for (const row of rows) {
      const label =
        key === "device"
          ? endpointIp(row.connection.source) || row.connection.source
          : (row.connection.domain || row.connection.destination || "").replace(/:\d+$/, "");
      if (label === "") {
        continue;
      }
      totals.set(label, (totals.get(label) ?? 0) + Number(row.downlinkTotal));
    }
    return [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
  }, [rows, key]);
}

/** 合并持久化历史与会话累计：面板可用时以持久化为准。 */
export function mergeOutboundTotals(
  history: HistoryResult | null,
  session: readonly [string, number][],
): { totals: readonly [string, number][]; persisted: boolean } {
  if (history !== null && hasPanelToken()) {
    const merged = new Map<string, number>();
    for (const point of history.points) {
      if (!point.out) {
        continue;
      }
      for (const [tag, bytes] of Object.entries(point.out)) {
        merged.set(tag, (merged.get(tag) ?? 0) + bytes);
      }
    }
    if (merged.size > 0) {
      return {
        totals: [...merged.entries()].sort((left, right) => right[1] - left[1]),
        persisted: true,
      };
    }
  }
  return { totals: session, persisted: false };
}

export interface NotificationEntry {
  t: number;
  kind: string;
  title: string;
  detail?: string;
  ok: boolean;
}

const NOTIFICATION_REFRESH_MS = 30_000;

/** Persisted backend event feed; empty in direct mode. */
export function useNotifications(): NotificationEntry[] {
  const [items, setItems] = useState<NotificationEntry[]>([]);
  useEffect(() => {
    if (!hasPanelToken()) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      if (document.hidden) {
        return;
      }
      const headers: HeadersInit = { "X-Panel-Token": getPanelToken() };
      fetch("/api/notifications", { headers })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("HTTP"))))
        .then((body: { notifications?: NotificationEntry[] }) => {
          if (!cancelled) {
            setItems(body.notifications ?? []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setItems([]);
          }
        });
    };
    load();
    const timer = window.setInterval(load, NOTIFICATION_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return items;
}

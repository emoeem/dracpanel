/**
 * Periodic node health sweep.
 *
 * Supersedes the plain "auto test" timer: it pauses while the tab is hidden,
 * probes groups with a small worker pool instead of one long serial chain,
 * persists what it learned, and tells the user (and the webhook) when a node
 * that used to work stops answering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DaemonApi } from "../api/daemon";
import type { Group } from "../gen/daemon/started_service_pb";
import { useToast } from "../components/Toast";
import { useNow } from "./context";
import {
  averageDelay,
  bestCandidate,
  healthOf,
  isNewOutage,
  isRecovered,
  summarizeHealth,
  type HealthStatus,
  type HealthSummary,
  type HealthVerdict,
  type LatencySample,
} from "../lib/healthCheck";
import { notify } from "../lib/notifier";
import {
  HEALTH_RUN_NOW_EVENT,
  HEALTH_SETTINGS_EVENT,
  loadHealthRun,
  loadHealthSettings,
  saveHealthRun,
  thresholdsOf,
  type HealthSettings,
} from "./healthPreferences";

/** How often the schedule wakes up to check whether a sweep is due. */
const TICK_MS = 20_000;

/** Groups probed at the same time. */
const PROBE_CONCURRENCY = 3;

export interface HealthMonitorOptions {
  api: DaemonApi;
  serverId: string;
  /** 0 disables the sweep. */
  intervalMs: number;
  active: boolean;
  groups: readonly Group[];
  histories: Record<string, LatencySample[]>;
}

export interface HealthMonitor {
  settings: HealthSettings;
  verdicts: Record<string, HealthVerdict>;
  statuses: Record<string, HealthStatus>;
  summary: HealthSummary;
  lastRunAt: number;
  running: boolean;
  runNow: () => void;
}

async function probeAll(api: DaemonApi, tags: readonly string[]): Promise<boolean> {
  let cursor = 0;
  let failed = false;
  const worker = async () => {
    while (cursor < tags.length) {
      const tag = tags[cursor++];
      if (tag === undefined) {
        continue;
      }
      try {
        await api.urlTest(tag);
      } catch {
        failed = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, tags.length) }, () => worker()),
  );
  return failed;
}

export function useHealthMonitor(options: HealthMonitorOptions): HealthMonitor {
  const { api, serverId, intervalMs, active, groups, histories } = options;
  const toast = useToast();
  /** Refreshes staleness: a sample older than the window says nothing. */
  const now = useNow(30_000);
  const [settings, setSettings] = useState<HealthSettings>(loadHealthSettings);
  const [lastRunAt, setLastRunAt] = useState(0);
  const [running, setRunning] = useState(false);

  const lastRunRef = useRef(0);
  const statusesRef = useRef<Record<string, HealthStatus>>({});
  const runningRef = useRef(false);
  const groupTags = useMemo(() => groups.map((group) => group.tag), [groups]);
  const tagsRef = useRef<readonly string[]>(groupTags);
  useEffect(() => {
    tagsRef.current = groupTags;
  }, [groupTags]);

  useEffect(() => {
    setSettings(loadHealthSettings());
    const refresh = () => setSettings(loadHealthSettings());
    window.addEventListener(HEALTH_SETTINGS_EVENT, refresh);
    return () => window.removeEventListener(HEALTH_SETTINGS_EVENT, refresh);
  }, []);

  useEffect(() => {
    const state = loadHealthRun(serverId);
    statusesRef.current = state.statuses;
    lastRunRef.current = state.lastRunAt;
    setLastRunAt(state.lastRunAt);
  }, [serverId]);

  const thresholds = useMemo(() => thresholdsOf(settings), [settings]);

  const verdicts = useMemo(() => {
    const result: Record<string, HealthVerdict> = {};
    for (const group of groups) {
      for (const item of group.items) {
        result[item.tag] = healthOf(histories[item.tag] ?? [], thresholds, now);
      }
    }
    return result;
  }, [groups, histories, now, thresholds]);

  const statuses = useMemo(() => {
    const result: Record<string, HealthStatus> = {};
    for (const [tag, verdict] of Object.entries(verdicts)) {
      result[tag] = verdict.status;
    }
    return result;
  }, [verdicts]);

  const summary = useMemo(() => summarizeHealth(Object.values(statuses)), [statuses]);

  // Announce transitions once: the persisted verdicts are the "already told" set.
  useEffect(() => {
    const previous = statusesRef.current;
    const outages: string[] = [];
    const recovered: string[] = [];
    for (const [tag, status] of Object.entries(statuses)) {
      const before = previous[tag] ?? "unknown";
      if (before === status) {
        continue;
      }
      if (isNewOutage(before, status)) {
        outages.push(tag);
      } else if (isRecovered(before, status)) {
        recovered.push(tag);
      }
    }
    if (outages.length === 0 && recovered.length === 0) {
      return;
    }
    statusesRef.current = statuses;
    saveHealthRun(serverId, { lastRunAt: lastRunRef.current, statuses });
    if (!settings.notify) {
      return;
    }
    if (outages.length > 0) {
      const list = `${outages.slice(0, 3).join("、")}${outages.length > 3 ? ` 等 ${outages.length} 个` : ""}`;
      toast(`节点不可用：${list}`, "danger");
      notify("health", "节点不可用", list);
    }
    if (recovered.length > 0) {
      toast(`节点恢复：${recovered.slice(0, 3).join("、")}`, "good");
      notify("health", "节点恢复", recovered.slice(0, 3).join("、"));
    }
  }, [serverId, settings.notify, statuses, toast]);

  // Opt-in failover: move a group off a node that is down.
  useEffect(() => {
    if (!settings.autoSwitch || !active) {
      return;
    }
    for (const group of groups) {
      if (!group.selectable) {
        continue;
      }
      const selected = verdicts[group.selected];
      if (selected === undefined || selected.status !== "down") {
        continue;
      }
      const candidates = group.items
        .filter((item) => item.tag !== group.selected)
        .map((item) => ({ tag: item.tag, delay: averageDelay(histories[item.tag] ?? []) }));
      const target = bestCandidate(candidates, 0, thresholds);
      if (target === null) {
        continue;
      }
      api.selectOutbound(group.tag, target).then(
        () => toast(`${group.tag} 已切换到 ${target}`, "info"),
        () => undefined,
      );
    }
  }, [active, api, groups, histories, settings.autoSwitch, thresholds, toast, verdicts]);

  const run = useCallback(async () => {
    if (runningRef.current) {
      return;
    }
    const tags = tagsRef.current;
    if (tags.length === 0) {
      return;
    }
    runningRef.current = true;
    setRunning(true);
    const failed = await probeAll(api, tags);
    const at = Date.now();
    lastRunRef.current = at;
    setLastRunAt(at);
    saveHealthRun(serverId, { lastRunAt: at, statuses: statusesRef.current });
    runningRef.current = false;
    setRunning(false);
    if (failed) {
      toast("部分节点探测失败", "info");
    }
  }, [api, serverId, toast]);

  // Views trigger a sweep through a DOM event: the schedule lives here so the
  // interval and the manual run can never race each other.
  useEffect(() => {
    const onDemand = () => void run();
    window.addEventListener(HEALTH_RUN_NOW_EVENT, onDemand);
    return () => window.removeEventListener(HEALTH_RUN_NOW_EVENT, onDemand);
  }, [run]);

  useEffect(() => {
    if (!active || intervalMs <= 0) {
      return;
    }
    const tick = () => {
      if (document.hidden || runningRef.current) {
        return;
      }
      if (Date.now() - lastRunRef.current < intervalMs) {
        return;
      }
      void run();
    };
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs, run]);

  return { settings, verdicts, statuses, summary, lastRunAt, running, runNow: () => void run() };
}

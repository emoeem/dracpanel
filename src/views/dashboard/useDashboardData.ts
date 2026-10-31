import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { testProxyDelay } from "../../api/clash";
import {
  getGeoIp,
  getManagedSubscriptions,
  listSubscriptions,
  updateSubscription,
  type GeoIpInfo,
  type PanelManagedSubscriptions,
  type PanelSubscription,
} from "../../api/panel";
import { hasPanelToken } from "../../api/panel";
import { useNow } from "../../app/context";
import { showError } from "../../app/errorStore";
import type { PanelStateResult } from "../../app/usePanelState";
import type { Group } from "../../gen/daemon/started_service_pb";
import {
  SERVICE_TARGETS,
  classifyServiceResult,
  currentProxyTag,
  type ServiceResult,
} from "../../lib/flclash/serviceStatus";
import { profileUsage, type ProfileUsage } from "../../lib/flclash/profileUsage";
import { dashboardLayout, type DashboardLayout } from "../../lib/flclash/layout";

const SERVICE_CONCURRENCY = 4;

function idleResults(): ServiceResult[] {
  return SERVICE_TARGETS.map((target) => ({
    key: target.key,
    state: "idle",
    delayMs: null,
  }));
}

export function useDashboardLayout() {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<DashboardLayout>(() => dashboardLayout(1200, 900));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => {
      setLayout(dashboardLayout(element.clientWidth || 1200, element.clientHeight || 900));
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, layout };
}

export function useProxyTag(groups: readonly Group[]): string | null {
  return useMemo(() => currentProxyTag(groups), [groups]);
}

export function useServiceStatus(active: boolean, proxyTag: string | null) {
  const [results, setResults] = useState<ServiceResult[]>(idleResults);
  const [testing, setTesting] = useState(false);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const runId = useRef(0);
  const autoTag = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (!proxyTag) {
      return;
    }
    const id = ++runId.current;
    setTesting(true);
    setResults(
      SERVICE_TARGETS.map((target) => ({ key: target.key, state: "testing", delayMs: null })),
    );
    const queue = [...SERVICE_TARGETS];
    const worker = async () => {
      while (queue.length > 0) {
        const target = queue.shift();
        if (!target) {
          return;
        }
        let result: ServiceResult;
        try {
          const delay = await testProxyDelay(proxyTag, target.url, 5_000);
          result = { ...classifyServiceResult(delay, null), key: target.key };
        } catch (error) {
          result = { ...classifyServiceResult(null, error), key: target.key };
        }
        if (id === runId.current) {
          setResults((current) =>
            current.map((entry) => (entry.key === target.key ? result : entry)),
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SERVICE_CONCURRENCY, SERVICE_TARGETS.length) }, worker),
    );
    if (id === runId.current) {
      setTesting(false);
      setLastRun(Date.now());
    }
  }, [proxyTag]);

  useEffect(() => {
    if (!active || !proxyTag) {
      setResults(idleResults());
      setTesting(false);
      autoTag.current = null;
      return;
    }
    if (autoTag.current === proxyTag) {
      return;
    }
    autoTag.current = proxyTag;
    void run();
  }, [active, proxyTag, run]);

  return { results, testing, lastRun, run };
}

export function useEgress(panel: PanelStateResult) {
  const [geo, setGeo] = useState<GeoIpInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const ip = panel.state?.egress_ip ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!ip) {
      setGeo(null);
      setProbing(false);
      return;
    }
    setProbing(true);
    void getGeoIp(ip)
      .then((value) => {
        if (!cancelled) {
          setGeo(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGeo(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProbing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ip]);

  const reprobe = useCallback(() => {
    panel.refresh();
    if (!ip) {
      setProbing(true);
      window.setTimeout(() => setProbing(false), 1200);
      return;
    }
    setProbing(true);
    void getGeoIp(ip)
      .then(setGeo)
      .catch(() => setGeo(null))
      .finally(() => setProbing(false));
  }, [ip, panel]);

  return { ip, geo, probing, reprobe };
}

export function useProfilesSummary(panel: PanelStateResult) {
  const [items, setItems] = useState<PanelSubscription[]>([]);
  const [managed, setManaged] = useState<PanelManagedSubscriptions | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setItems([]);
      setManaged(null);
      return;
    }
    const [subscriptions, managedResult] = await Promise.allSettled([
      listSubscriptions(),
      getManagedSubscriptions(),
    ]);
    if (subscriptions.status === "fulfilled") {
      setItems(subscriptions.value.subscriptions ?? []);
    }
    if (managedResult.status === "fulfilled") {
      setManaged(managedResult.value);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, panel.state?.config_mtime, panel.state?.config_path]);

  const summary: ProfileUsage = useMemo(
    () =>
      profileUsage(
        items,
        managed,
        panel.state?.config_path,
        panel.state?.config_mtime,
        now,
      ),
    [items, managed, panel.state?.config_mtime, panel.state?.config_path, now],
  );

  const sync = useCallback(async () => {
    const subscription = summary.subscription;
    if (!subscription) {
      return;
    }
    setBusy(true);
    try {
      const result = await updateSubscription(subscription.id);
      if (!result.ok) {
        throw new Error(result.message || "更新配置失败");
      }
      await load();
      panel.refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }, [load, panel, summary.subscription]);

  return { summary, busy, sync, reload: load };
}

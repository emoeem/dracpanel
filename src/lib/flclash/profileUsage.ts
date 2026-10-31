import type { PanelManagedSubscriptions, PanelSubscription } from "../../api/panel";
import { daysUntil, usageSummary, type UsageSummary } from "./format";

export interface ProfileUsage {
  subscription: PanelSubscription | null;
  name: string;
  updatedAt: number | null;
  usage: UsageSummary;
  daysLeft: number | null;
  nodeCount: number;
  hasUsage: boolean;
}

function fileStem(path: string | null | undefined): string {
  if (!path) {
    return "";
  }
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.(json|yaml|yml)$/i, "");
}

/**
 * The panel can manage several subscriptions; the dashboard card shows the
 * most recently updated enabled one (or the running config filename when no
 * subscription carries usage metadata).
 */
export function chooseActiveSubscription(
  items: readonly PanelSubscription[],
  managed: PanelManagedSubscriptions | null,
): PanelSubscription | null {
  const enabled = items.filter((item) => item.enabled !== false);
  const pool = enabled.length > 0 ? enabled : items;
  if (pool.length === 0) {
    return null;
  }
  if (managed?.managed_group) {
    const byName = pool.find((item) => item.name === managed.managed_group);
    if (byName) {
      return byName;
    }
  }
  return [...pool].sort((left, right) => {
    const leftTime = left.last_update ?? left.last_attempt ?? 0;
    const rightTime = right.last_update ?? right.last_attempt ?? 0;
    return rightTime - leftTime;
  })[0];
}

export function profileUsage(
  items: readonly PanelSubscription[],
  managed: PanelManagedSubscriptions | null,
  configPath: string | null | undefined,
  configMtime: number | null | undefined,
  nowMs: number,
): ProfileUsage {
  const subscription = chooseActiveSubscription(items, managed);
  const userinfo = subscription?.userinfo ?? {};
  const usage = usageSummary(userinfo.upload, userinfo.download, userinfo.total);
  const updatedAt =
    subscription?.last_update !== null && subscription?.last_update !== undefined
      ? subscription.last_update * 1000
      : configMtime !== null && configMtime !== undefined
        ? configMtime * 1000
        : null;
  return {
    subscription,
    name: subscription?.name || fileStem(configPath) || "配置",
    updatedAt,
    usage,
    daysLeft: daysUntil(userinfo.expire, nowMs),
    nodeCount: subscription?.node_count ?? 0,
    hasUsage:
      typeof userinfo.total === "number" && userinfo.total > 0,
  };
}

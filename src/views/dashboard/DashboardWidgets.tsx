import { useMemo, useState } from "react";

import { useApi } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useI18n } from "../../app/i18n";
import { Icon } from "../../components/Icon";
import {
  FcButton,
  FcCard,
  FcCardHeader,
  FcDonut,
  FcSelect,
  FcSparkline,
} from "../../components/flclash";
import type { ConnectionRow } from "../../api/daemon";
import type { Group } from "../../gen/daemon/started_service_pb";
import type { LatencySample } from "../../lib/latencyHistory";
import { latencyStats } from "../../lib/latencyHistory";
import { useDnsLedger } from "../../lib/flclash/dnsLedger";
import { cx } from "../../lib/cx";
import styles from "./DashboardWidgets.module.css";

const DONUT_COLORS = [
  "var(--fc-primary)",
  "var(--fc-series-2)",
  "var(--fc-info)",
  "var(--fc-warning)",
  "var(--fc-success)",
  "var(--fc-on-surface-faint)",
];

const LATENCY_PREVIEW = 6;

/**
 * Node latency widget: min / max / average over every node that has a delay
 * sample, plus a per-node sparkline from the persisted latency history. This is
 * the doona "最低/最高 + 每节点 sparkline + 显示全部" card, limited to data the
 * core actually reports (no invented percentiles).
 */
export function WidgetLatency({
  groups,
  histories,
  onOpenNodes,
}: {
  groups: readonly Group[];
  histories: Readonly<Record<string, readonly LatencySample[]>>;
  onOpenNodes: () => void;
}) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);

  const nodes = useMemo(() => {
    const seen = new Set<string>();
    const rows: { tag: string; delay: number; history: number[] }[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        if (seen.has(item.tag) || item.urlTestDelay <= 0) {
          continue;
        }
        seen.add(item.tag);
        rows.push({
          tag: item.tag,
          delay: item.urlTestDelay,
          history: (histories[item.tag] ?? []).map((sample) => sample.delay),
        });
      }
    }
    return rows.sort((left, right) => left.delay - right.delay);
  }, [groups, histories]);

  const delays = nodes.map((node) => node.delay);
  const summary = useMemo(() => latencyStats(delays.map((delay, index) => ({ at: index, delay }))), [delays]);
  const visible = showAll ? nodes : nodes.slice(0, LATENCY_PREVIEW);

  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        icon={<Icon name="bolt" size={14} />}
        title={t("Node latency")}
        subtitle={
          summary === null
            ? undefined
            : `${t("Min")} ${summary.min}ms · ${t("Max")} ${summary.max}ms · ${t("Average")} ${summary.avg}ms`
        }
        actions={
          <button type="button" className={styles.linkButton} onClick={onOpenNodes}>
            {t("Open nodes page")}
          </button>
        }
      />
      {nodes.length === 0 ? (
        <div className={styles.hintBlock}>
          {t("No latency samples yet. Test a node on the nodes page.")}
        </div>
      ) : (
        <>
          <ul className={styles.latencyList} data-expanded={showAll}>
            {visible.map((node) => (
              <li key={node.tag} className={styles.latencyRow}>
                <span className={styles.latencyName} title={node.tag}>
                  {node.tag}
                </span>
                <span className={styles.latencySpark}>
                  <FcSparkline data={node.history.length >= 2 ? node.history : [node.delay, node.delay]} height={22} />
                </span>
                <span
                  className={cx(
                    styles.latencyValue,
                    node.delay > 300 && styles.latencyBad,
                    node.delay <= 120 && styles.latencyGood,
                  )}
                >
                  {node.delay}ms
                </span>
              </li>
            ))}
          </ul>
          {nodes.length > LATENCY_PREVIEW && (
            <button type="button" className={styles.moreButton} onClick={() => setShowAll((value) => !value)}>
              {showAll ? t("Show less") : t("Show all {count}", { count: nodes.length })}
            </button>
          )}
        </>
      )}
    </FcCard>
  );
}

/** Active connections grouped by the outbound that carries them. */
export function WidgetOutboundConnections({ rows }: { rows: readonly ConnectionRow[] }) {
  const { t } = useI18n();
  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.closedAt !== null) {
        continue;
      }
      const chain = row.connection.chainList;
      const outbound =
        (chain.length > 1 ? chain[chain.length - 1] : row.connection.outbound) || "direct";
      counts.set(outbound, (counts.get(outbound) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [rows]);

  const top = buckets.slice(0, 5);
  const rest = buckets.slice(5).reduce((sum, [, count]) => sum + count, 0);
  const slices = [
    ...top.map(([label, value], index) => ({
      label,
      value,
      color: DONUT_COLORS[index % DONUT_COLORS.length],
    })),
    ...(rest > 0 ? [{ label: "…", value: rest, color: DONUT_COLORS[5] }] : []),
  ];
  const total = buckets.reduce((sum, [, count]) => sum + count, 0);

  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        icon={<Icon name="hub" size={14} />}
        title={t("Connections by outbound")}
        subtitle={`${t("Active connections")} ${total}`}
      />
      {total === 0 ? (
        <div className={styles.hintBlock}>{t("No samples yet")}</div>
      ) : (
        <>
          <FcDonut slices={slices} centerLabel={`${total}`} size={112} />
          <ul className={styles.legendList}>
            {top.map(([label, count], index) => (
              <li key={label}>
                <i className={styles.dot} style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                <span className={styles.legendLabel} title={label}>
                  {label}
                </span>
                <strong>{count}</strong>
              </li>
            ))}
            {rest > 0 && (
              // The donut folds everything past the top 5 into one grey slice;
              // the legend has to name it or the numbers stop adding up.
              <li>
                <i className={styles.dot} style={{ background: DONUT_COLORS[5] }} />
                <span className={styles.legendLabel} title={t("Other outbounds")}>
                  {t("Other outbounds")}
                </span>
                <strong>{rest}</strong>
              </li>
            )}
          </ul>
        </>
      )}
    </FcCard>
  );
}

/** DNS query ledger (in-session) — the doona "DNS 查询结果" widget. */
export function WidgetDnsResults({ onOpenDns }: { onOpenDns: () => void }) {
  const { t } = useI18n();
  const entries = useDnsLedger();
  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        icon={<Icon name="dns" size={14} />}
        title={t("DNS results")}
        actions={
          <button type="button" className={styles.linkButton} onClick={onOpenDns}>
            {t("Open DNS page")}
          </button>
        }
      />
      {entries.length === 0 ? (
        <div className={styles.hintBlock}>{t("No DNS queries recorded in this session.")}</div>
      ) : (
        <ul className={styles.dnsList}>
          {entries.slice(0, 6).map((entry) => (
            <li key={entry.id}>
              <span className={cx(styles.dnsDot, entry.ok ? styles.dnsOk : styles.dnsBad)} />
              <span className={styles.dnsName} title={`${entry.name} ${entry.type}`}>
                {entry.name}
              </span>
              <span className={styles.dnsType}>{entry.type}</span>
              <span className={styles.dnsResult} title={entry.result}>
                {entry.ok ? entry.result || "—" : t("Failed")}
              </span>
              <span className={styles.dnsTime}>{Math.round(entry.elapsedMs)}ms</span>
            </li>
          ))}
        </ul>
      )}
    </FcCard>
  );
}

/** Policy groups with their current node; the chip links into the group page. */
export function WidgetPolicyGroups({
  groups,
  onOpenGroup,
}: {
  groups: readonly Group[];
  onOpenGroup: (tag: string) => void;
}) {
  const { t } = useI18n();
  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        icon={<Icon name="layers" size={14} />}
        title={t("Policy groups")}
        subtitle={`${groups.length}`}
      />
      {groups.length === 0 ? (
        <div className={styles.hintBlock}>{t("Policy groups are unavailable; check the core connection.")}</div>
      ) : (
        <ul className={styles.groupList}>
          {groups.map((group) => (
            <li key={group.tag}>
              <button type="button" className={styles.groupRow} onClick={() => onOpenGroup(group.tag)}>
                <span className={styles.groupTag}>{group.tag}</span>
                <span className={styles.groupSelected} title={group.selected}>
                  {group.selected || "—"}
                </span>
                <Icon name="chevron_right" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </FcCard>
  );
}

/**
 * Global outbound: pick the policy group that carries the default route, then
 * its current node. Applies through the core's selector API; nothing is written
 * to the config file, so the choice survives an apply only as far as the core
 * keeps it (same semantics as the group sheet).
 */
export function WidgetGlobalOutbound({ groups }: { groups: readonly Group[] }) {
  const { t } = useI18n();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const selectable = groups.filter((group) => group.selectable);
  const [tag, setTag] = useState<string>(() => selectable[0]?.tag ?? "");
  const group = selectable.find((item) => item.tag === tag) ?? selectable[0] ?? null;
  const selected = group?.selected ?? "";

  const apply = (node: string) => {
    if (!group || node === "" || node === group.selected) {
      return;
    }
    setBusy(true);
    api
      .selectOutbound(group.tag, node)
      .catch(showError)
      .finally(() => setBusy(false));
  };

  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        icon={<Icon name="swap_horiz" size={14} />}
        title={t("Global outbound")}
        subtitle={group?.tag}
      />
      {selectable.length === 0 ? (
        <div className={styles.hintBlock}>{t("Policy groups are unavailable; check the core connection.")}</div>
      ) : (
        <div className={styles.outboundBody}>
          <FcSelect
            value={group?.tag ?? ""}
            onChange={(value) => setTag(value)}
            className={styles.outboundSelect}
          >
            {selectable.map((item) => (
              <option key={item.tag} value={item.tag}>
                {item.tag}
              </option>
            ))}
          </FcSelect>
          <FcSelect
            value={selected}
            disabled={busy || group === null}
            onChange={apply}
            className={styles.outboundSelect}
          >
            {group?.items.map((item) => (
              <option key={item.tag} value={item.tag}>
                {item.tag}
              </option>
            ))}
          </FcSelect>
          <p className={styles.hintLine}>{t("Select a policy group to change its current node.")}</p>
        </div>
      )}
    </FcCard>
  );
}

/** Compact footer action used by the widgets above. */
export function WidgetLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <FcButton variant="text" size="small" onClick={onClick}>
      {label}
    </FcButton>
  );
}

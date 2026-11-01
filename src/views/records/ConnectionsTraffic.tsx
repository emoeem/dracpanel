import { useMemo, useState } from "react";

import type { ConnectionRow, GroupsData } from "../../api/daemon";
import { FcCard, FcCardHeader, FcScatter, type ScatterPoint } from "../../components/flclash";
import { formatBytes } from "../../api/format";
import { connectionHost } from "../../lib/connectionTools";
import { countWithData, percentile, weightedPercentile } from "../../lib/latencyStats";
import { cx } from "../../lib/cx";
import styles from "./ConnectionsTraffic.module.css";

const COLORS = ["#8b5cf6", "#f97316", "#22c55e", "#eab308", "#ef4444", "#06b6d4", "#ec4899"];

function outboundOf(row: ConnectionRow): string {
  const chains = row.connection.chainList;
  if (chains.length > 1) {
    return chains[chains.length - 1];
  }
  return row.connection.outbound || "direct";
}

/** 连接「流量」视图：最高流量、总量、散点图与节点延迟分位。 */
export function ConnectionsTraffic({
  rows,
  groups,
  onOpen,
}: {
  rows: readonly ConnectionRow[];
  groups: GroupsData;
  onOpen: (row: ConnectionRow) => void;
}) {
  const [selected, setSelected] = useState<string>("");

  const byOutbound = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const tag = outboundOf(row);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const ordered = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    const colors = new Map<string, string>();
    ordered.forEach(([tag], index) => colors.set(tag, COLORS[index % COLORS.length]));
    return { ordered, colors };
  }, [rows]);

  const visible = useMemo(
    () => (selected === "" ? rows : rows.filter((row) => outboundOf(row) === selected)),
    [rows, selected],
  );

  const points = useMemo<ScatterPoint[]>(
    () =>
      visible.map((row) => ({
        id: row.connection.id,
        x: Math.max(1, Number(row.uplinkTotal)),
        y: Math.max(1, Number(row.downlinkTotal)),
        color: byOutbound.colors.get(outboundOf(row)) ?? COLORS[0],
        label: `${connectionHost(row)} · ${outboundOf(row)} · ↓${formatBytes(Number(row.downlinkTotal))}`,
      })),
    [byOutbound.colors, visible],
  );

  const top = useMemo(() => {
    let best: ConnectionRow | null = null;
    let down = 0;
    let up = 0;
    for (const row of rows) {
      const rowDown = Number(row.downlinkTotal);
      down += rowDown;
      up += Number(row.uplinkTotal);
      if (best === null || rowDown > Number(best.downlinkTotal)) {
        best = row;
      }
    }
    return { best, down, up };
  }, [rows]);

  const latency = useMemo(() => {
    const delays: number[] = [];
    const weights: number[] = [];
    const connectionsPerTag = new Map<string, number>();
    for (const row of visible) {
      const chains = row.connection.chainList;
      const node = chains[0] || row.connection.outbound;
      connectionsPerTag.set(node, (connectionsPerTag.get(node) ?? 0) + 1);
    }
    let totalNodes = 0;
    const seen = new Set<string>();
    for (const group of groups.groups) {
      for (const item of group.items) {
        if (seen.has(item.tag)) {
          continue;
        }
        seen.add(item.tag);
        totalNodes += 1;
        if (item.urlTestDelay > 0) {
          delays.push(item.urlTestDelay);
          weights.push(connectionsPerTag.get(item.tag) ?? 0);
        }
      }
    }
    return {
      total: totalNodes,
      withData: countWithData(delays),
      p50: percentile(delays, 0.5),
      p90: percentile(delays, 0.9),
      weightedP50: weightedPercentile(delays, weights, 0.5),
    };
  }, [groups.groups, visible]);

  const rowById = useMemo(() => {
    const map = new Map<string, ConnectionRow>();
    for (const row of rows) {
      map.set(row.connection.id, row);
    }
    return map;
  }, [rows]);

  return (
    <div className={styles.stack}>
      <div className={styles.topRow}>
        <FcCard className={styles.topCard}>
          <FcCardHeader title="最高流量连接" />
          <div className={styles.topHost}>{top.best ? connectionHost(top.best) : "—"}</div>
          <div className={styles.topMeta}>{top.best ? outboundOf(top.best) : "暂无连接"}</div>
        </FcCard>
        <FcCard className={styles.statCard}>
          <FcCardHeader title="下载" />
          <div className={styles["stat-value"]}>{formatBytes(top.down)}</div>
        </FcCard>
        <FcCard className={styles.statCard}>
          <FcCardHeader title="上传" />
          <div className={styles["stat-value"]}>{formatBytes(top.up)}</div>
        </FcCard>
      </div>

      <FcCard>
        <FcCardHeader title="连接流量" subtitle={`连接 ${visible.length} · 横轴上传 / 纵轴下载`} />
        {points.length === 0 ? (
          <div className={styles.empty}>暂无连接</div>
        ) : (
          <FcScatter
            points={points}
            onSelect={(id) => {
              const row = rowById.get(id);
              if (row) {
                onOpen(row);
              }
            }}
          />
        )}
        <div className={styles.legend}>
          {byOutbound.ordered.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              className={cx(styles.legendItem, selected === tag && styles.legendActive)}
              onClick={() => setSelected((current) => (current === tag ? "" : tag))}
            >
              <span className={styles.swatch} style={{ background: byOutbound.colors.get(tag) }} />
              {tag}
              <span className={styles.legendCount}>{count}</span>
            </button>
          ))}
        </div>
      </FcCard>

      <FcCard>
        <FcCardHeader title="节点延迟" subtitle={`有延迟的节点 ${latency.withData} · 无数据 ${latency.total - latency.withData}`} />
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles["stat-label"]}>全部节点 P50</span>
            <span className={styles.statNumber}>{latency.p50 === null ? "—" : `${Math.round(latency.p50)} ms`}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles["stat-label"]}>全部节点 P90</span>
            <span className={styles.statNumber}>{latency.p90 === null ? "—" : `${Math.round(latency.p90)} ms`}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles["stat-label"]}>按连接数加权 P50</span>
            <span className={styles.statNumber}>
              {latency.weightedP50 === null ? "—" : `${Math.round(latency.weightedP50)} ms`}
            </span>
          </div>
        </div>
      </FcCard>
    </div>
  );
}
